// Import past "New Lead" messages (and their thread replies) from the sales channel.
//   npm run backfill            -> last 90 days
//   npm run backfill -- 365     -> last 365 days
// Safe to re-run: messages already imported are skipped.
import 'dotenv/config';
import { WebClient } from '@slack/web-api';
import { isNewLeadMessage } from '../src/parser.js';
import { ingestMessage } from '../src/ingest.js';
import { addActivity } from '../src/db.js';

const { SLACK_BOT_TOKEN, SLACK_SALES_CHANNEL_ID } = process.env;
if (!SLACK_BOT_TOKEN || !SLACK_SALES_CHANNEL_ID) {
  console.error('Set SLACK_BOT_TOKEN and SLACK_SALES_CHANNEL_ID in .env first.');
  process.exit(1);
}

const days = Number(process.argv[2] || 90);
const client = new WebClient(SLACK_BOT_TOKEN);
const names = new Map();
const resolveUser = async (id) => {
  if (!names.has(id)) {
    const { user } = await client.users.info({ user: id }).catch(() => ({ user: null }));
    names.set(id, user?.profile?.display_name || user?.real_name || id);
  }
  return names.get(id);
};

const oldest = String(Date.now() / 1000 - days * 86400);
let created = 0, skipped = 0;

for await (const page of client.paginate('conversations.history', { channel: SLACK_SALES_CHANNEL_ID, oldest, limit: 200 })) {
  for (const m of page.messages) {
    if (m.subtype || m.bot_id || !isNewLeadMessage(m.text)) continue;
    const { permalink } = await client.chat.getPermalink({ channel: SLACK_SALES_CHANNEL_ID, message_ts: m.ts }).catch(() => ({}));
    const result = await ingestMessage(
      {
        text: m.text,
        postedAt: new Date(Number(m.ts) * 1000),
        channel: SLACK_SALES_CHANNEL_ID,
        ts: m.ts,
        permalink,
        postedBy: await resolveUser(m.user),
      },
      resolveUser
    );
    result.created ? created++ : skipped++;

    if (m.reply_count) {
      const { messages: replies } = await client.conversations.replies({ channel: SLACK_SALES_CHANNEL_ID, ts: m.ts });
      for (const r of replies.slice(1)) {
        if (r.bot_id) continue;
        const at = new Date(Number(r.ts) * 1000).toISOString().replace('T', ' ').slice(0, 19);
        addActivity(result.lead.id, 'slack_reply', r.text, await resolveUser(r.user), r.ts, at);
      }
    }
  }
}
console.log(`Backfill done: ${created} leads created, ${skipped} already present (last ${days} days).`);
