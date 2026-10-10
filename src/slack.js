// Slack bot (Socket Mode — no public URL needed).
// - Top-level "New Lead/ ..." messages in the sales channel become leads.
// - Replies in that message's thread are saved to the lead's activity log.
// - A reply that tags someone assigns the owner if the lead has none yet.
import bolt from '@slack/bolt';
import { isNewLeadMessage, extractMentions, parseScreenshotLead } from './parser.js';
import { imageToText } from './ocr.js';
import { ingestMessage } from './ingest.js';
import { getLeadBySlackTs, addActivity, updateLead } from './db.js';

const { App, LogLevel } = bolt;
const APP_URL = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
const SALES_CHANNEL = process.env.SLACK_SALES_CHANNEL_ID;

let app = null;
let botToken = null;

// Screenshots: download each image attached to a message and read its text.
// Needs the files:read scope; without it Slack returns a login page instead of the image.
async function readScreenshots(message) {
  const images = (message.files || []).filter((f) => f.mimetype?.startsWith('image/'));
  if (!images.length) return null;
  const texts = [];
  for (const f of images.slice(0, 4)) {
    const res = await fetch(f.url_private_download || f.url_private, { headers: { Authorization: `Bearer ${botToken}` } });
    if (!res.ok || (res.headers.get('content-type') || '').includes('text/html')) {
      throw Object.assign(new Error('missing files:read'), { code: 'files_read' });
    }
    texts.push(await imageToText(Buffer.from(await res.arrayBuffer())));
  }
  return texts.filter(Boolean).join('\n\n');
}
const userNames = new Map();

export const slackEnabled = () => Boolean(app);

export async function resolveUser(id) {
  if (!app || !id) return id;
  if (userNames.has(id)) return userNames.get(id);
  try {
    const { user } = await app.client.users.info({ user: id });
    const name = user.profile?.display_name || user.real_name || user.name || id;
    userNames.set(id, name);
    return name;
  } catch {
    return id;
  }
}

async function permalink(channel, ts) {
  try {
    return (await app.client.chat.getPermalink({ channel, message_ts: ts })).permalink;
  } catch {
    return null;
  }
}

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : null;

const STAGE = { closed_lost: 'Closed / Lost', completed_project: 'Completed project' };

function duplicateWarning(lead, duplicates) {
  const d = duplicates[0];
  const who = d.lead.owner_slack_id ? `<@${d.lead.owner_slack_id}>` : d.lead.owner_name || 'nobody';
  const when = new Date(d.lead.created_at + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const lines = [
    d.closed
      ? `🔁 *Returning client?* "${d.lead.company}" is already in the CRM as *${STAGE[d.lead.status]}* (owner ${who}, added ${when}).`
      : `⚠️ *Possible duplicate* (${d.confidence}) of "${d.lead.company}", owned by ${who}, added ${when}.`,
    `_${d.reasons.join(' · ')}_`,
  ];
  if (d.lead.owner_slack_id && lead.owner_slack_id && d.lead.owner_slack_id !== lead.owner_slack_id) {
    lines.push(`👥 Different owners: <@${lead.owner_slack_id}> and <@${d.lead.owner_slack_id}>, please agree who takes it.`);
  }
  if (duplicates.length > 1) lines.push(`…and ${duplicates.length - 1} more similar lead${duplicates.length > 2 ? 's' : ''}.`);
  lines.push(`<${APP_URL}/#duplicates|Review & merge in the CRM>`);
  return lines.join('\n');
}

function confirmation(lead, missingOwner) {
  const contact = [lead.contact_name, lead.contact_role && `(${lead.contact_role})`].filter(Boolean).join(' ');
  const bits = [
    `✅ *${lead.company}* added to the pipeline`,
    contact,
    lead.owner_slack_id ? `Owner: <@${lead.owner_slack_id}>` : null,
    lead.next_follow_up_at ? `Follow-up: ${fmtDate(lead.next_follow_up_at)}` : null,
  ].filter(Boolean);
  let text = `${bits.join(' · ')}\n<${APP_URL}/#lead-${lead.id}|Open in CRM>`;
  if (lead.from_screenshot) text += `\n📷 Read from a screenshot: please check the details and correct anything in the CRM.`;
  if (lead.company_missing) text += `\n❓ I couldn't tell which company this is. Reply here with the company name, or set it in the CRM.`;
  if (missingOwner) text += `\n⚠️ No owner tagged. Reply in this thread tagging the person who owns this lead.`;
  if (lead.follow_up_defaulted) text += `\n🗓 No date in *Next Step*, so I set the follow-up to ${fmtDate(lead.next_follow_up_at)}. Change it in the CRM if needed.`;
  return text;
}

export async function startSlack() {
  // SLACK=off keeps a local copy from competing with the hosted bot for the same messages.
  if (process.env.SLACK === 'off') {
    console.log('[slack] SLACK=off: running without Slack (the hosted copy handles the channel).');
    return null;
  }
  // Pasted secrets often carry quotes or spaces; strip them so a copy-paste slip isn't fatal.
  const tidy = (v) => (v || '').trim().replace(/^['"]|['"]$/g, '').trim();
  const SLACK_BOT_TOKEN = tidy(process.env.SLACK_BOT_TOKEN);
  const SLACK_APP_TOKEN = tidy(process.env.SLACK_APP_TOKEN);
  if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN) {
    console.log('[slack] SLACK_BOT_TOKEN / SLACK_APP_TOKEN not set — running without Slack.');
    return null;
  }
  // Check the bot token first: a bad token should leave the dashboard running, not crash it.
  try {
    const who = await new bolt.webApi.WebClient(SLACK_BOT_TOKEN).auth.test();
    console.log(`[slack] bot token OK (${who.user} in ${who.team})`);
  } catch (err) {
    console.error(`[slack] bot token rejected (${err.data?.error || err.message}); running without Slack. ` +
      `Check SLACK_BOT_TOKEN: it should start with xoxb- and be about 57 characters, with no quotes or spaces.`);
    return null;
  }
  const candidate = new App({ token: SLACK_BOT_TOKEN, appToken: SLACK_APP_TOKEN, socketMode: true, logLevel: LogLevel.WARN, deferInitialization: true });
  try {
    await candidate.init();
  } catch (err) {
    console.error('[slack] could not initialise:', err.data?.error || err.message);
    return null;
  }
  app = candidate;
  botToken = SLACK_BOT_TOKEN;

  app.message(async ({ message: incoming, client }) => {
    let message = incoming;
    // An edited post that only now reads like a lead (e.g. a header was added) is picked up too.
    if (message.subtype === 'message_changed' && message.message && !message.message.thread_ts) {
      const edited = { ...message.message, channel: message.channel };
      if (!getLeadBySlackTs(edited.ts) && isNewLeadMessage(edited.text)) message = edited;
      else return;
    } else if (message.subtype && message.subtype !== 'file_share') return; // joins, bot posts
    if (message.bot_id) return;
    if (SALES_CHANNEL && message.channel !== SALES_CHANNEL) return;

    const isReply = message.thread_ts && message.thread_ts !== message.ts;

    if (isReply) {
      const lead = getLeadBySlackTs(message.thread_ts);
      if (!lead) return;
      const author = await resolveUser(message.user);
      const shot = await readScreenshots(message).catch(() => null);
      addActivity(lead.id, 'slack_reply', [message.text, shot && `📷 Screenshot text:\n${shot}`].filter(Boolean).join('\n\n'), author, message.ts, null);
      // "Reply here with the company name": a short answer fills in a missing company.
      const answer = (message.text || '').replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/g, '').trim();
      if (/company TBC\)$/.test(lead.company) && answer && answer.split(/\s+/).length <= 6 && !/[?]/.test(answer)) {
        updateLead(lead.id, { company: answer.replace(/[.!]+$/, '') });
        addActivity(lead.id, 'edit', `Company set to ${answer} from the thread`, author);
        await client.reactions.add({ channel: message.channel, timestamp: message.ts, name: 'white_check_mark' }).catch(() => {});
      }
      if (!lead.owner_slack_id) {
        const [ownerId] = extractMentions(message.text);
        if (ownerId) {
          const name = await resolveUser(ownerId);
          updateLead(lead.id, { owner_slack_id: ownerId, owner_name: name });
          addActivity(lead.id, 'edit', `Owner set to ${name}`, author);
          await client.reactions.add({ channel: message.channel, timestamp: message.ts, name: 'white_check_mark' }).catch(() => {});
        }
      }
      return;
    }

    // Screenshot posts: read the image, then treat it like a typed lead.
    let parsed = null, rawText = message.text || '';
    if (message.files?.some((f) => f.mimetype?.startsWith('image/'))) {
      try {
        const ocr = await readScreenshots(message);
        if (ocr && (isNewLeadMessage(rawText) || ocr.length >= 40)) {
          const postedAt = new Date(Number(message.ts) * 1000);
          parsed = parseScreenshotLead({ note: rawText, ocr, postedAt });
          rawText = [rawText, `📷 Screenshot text:\n${ocr}`].filter(Boolean).join('\n\n');
        }
      } catch (err) {
        if (!isNewLeadMessage(rawText)) {
          await client.chat.postMessage({ channel: message.channel, thread_ts: message.ts, unfurl_links: false,
            text: err.code === 'files_read'
              ? "📷 I can't open screenshots yet: the app needs the *files:read* permission. Until then, paste the text or use the lead template."
              : "📷 I couldn't read that screenshot. Paste the key details as text (or use the lead template) and I'll add it." });
          return;
        }
      }
    }
    if (!parsed && !isNewLeadMessage(rawText)) return;
    const { lead, created, missingOwner, duplicates } = await ingestMessage(
      {
        text: rawText,
        parsed,
        postedAt: new Date(Number(message.ts) * 1000),
        channel: message.channel,
        ts: message.ts,
        permalink: await permalink(message.channel, message.ts),
        postedBy: await resolveUser(message.user),
      },
      resolveUser
    );
    if (!created) return;
    await client.chat.postMessage({
      channel: message.channel,
      thread_ts: message.ts,
      text: confirmation(lead, missingOwner) + (duplicates.length ? `\n\n${duplicateWarning(lead, duplicates)}` : ''),
      unfurl_links: false,
    });
  });

  try {
    await app.start();
  } catch (err) {
    console.error('[slack] could not connect (check SLACK_APP_TOKEN, xapp-…):', err.data?.error || err.message);
    app = null;
    return null;
  }
  console.log(`[slack] connected (Socket Mode)${SALES_CHANNEL ? `, watching ${SALES_CHANNEL}` : ', watching every channel the bot is in'}`);
  return app;
}

/** Post a status change back into the lead's Slack thread. */
export async function notifyThread(lead, text) {
  if (!app || !lead.slack_channel || !lead.slack_ts) return;
  await app.client.chat
    .postMessage({ channel: lead.slack_channel, thread_ts: lead.slack_ts, text, unfurl_links: false })
    .catch((err) => console.warn('[slack] thread post failed:', err.data?.error || err.message));
}

export const getSlackApp = () => app;

/** Post a top-level message in the sales channel (used by the reminder flow). */
export async function postToSalesChannel(text, lead) {
  if (!app) throw new Error('Slack is not connected');
  const channel = SALES_CHANNEL || lead?.slack_channel;
  if (!channel) throw new Error('No sales channel configured');
  await app.client.chat.postMessage({ channel, text, unfurl_links: false, unfurl_mentions: false });
}
