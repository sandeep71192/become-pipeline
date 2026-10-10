// One path for turning a message into a lead, used by the Slack bot, the
// backfill script, the "paste a message" form and the seed script.
import { parseLeadMessage } from './parser.js';
import { refineWithLLM } from './extract.js';
import { insertLead, getLeadBySlackTs, addActivity, applyCorrections } from './db.js';
import { findDuplicates } from './duplicates.js';

/**
 * @param {object} msg
 * @param {string} msg.text
 * @param {Date}   [msg.postedAt]
 * @param {string} [msg.channel]
 * @param {string} [msg.ts]          Slack message ts (dedupe key)
 * @param {string} [msg.permalink]
 * @param {string} [msg.postedBy]
 * @param {(id: string) => Promise<string>} [resolveUser]  Slack ID -> display name
 * @returns {Promise<{lead: object|null, created: boolean, missingOwner: boolean, duplicates: object[]}>}
 */
export async function ingestMessage(msg, resolveUser = async (id) => id) {
  if (msg.ts) {
    const existing = getLeadBySlackTs(msg.ts);
    if (existing) return { lead: existing, created: false, missingOwner: !existing.owner_name, duplicates: [] };
  }
  const postedAt = msg.postedAt ?? new Date();
  const parsed = parseLeadMessage(msg.text, postedAt);
  if (!parsed) return { lead: null, created: false, missingOwner: false, duplicates: [] };

  const fields = await refineWithLLM(msg.text, postedAt, parsed);
  const learned = applyCorrections(fields);   // fixes the team made to similar posts before

  // Owner = the first person tagged in the message.
  const ownerId = fields.owner_slack_ids[0] ?? null;
  const ownerName = ownerId ? await resolveUser(ownerId) : fields.owner_plain;

  const lead = insertLead({
    company: fields.company,
    contact_name: fields.contact_name,
    contact_role: fields.contact_role,
    need: fields.need,
    source_person: fields.source_person,
    source_event: fields.source_event,
    next_step: fields.next_step,
    next_follow_up_at: fields.next_follow_up_at,
    contact_email: fields.contact_email,
    contact_phone: fields.contact_phone,
    value: fields.value,
    owner_slack_id: ownerId,
    owner_name: ownerName,
    raw_message: msg.text,
    slack_channel: msg.channel,
    slack_ts: msg.ts,
    slack_permalink: msg.permalink,
    posted_by: msg.postedBy,
    created_at: msg.postedAt ? toSqlTime(msg.postedAt) : undefined,
  });
  if (learned.length) addActivity(lead.id, 'edit', `Applied earlier corrections to: ${learned.join(', ').replaceAll('_', ' ')}`, 'Parser');
  if (fields.follow_up_defaulted) lead.follow_up_defaulted = true;
  if (fields.company_missing) lead.company_missing = true;
  // Never silently double-count: the new lead is kept, but flagged for the review queue.
  const duplicates = findDuplicates(lead, { excludeId: lead.id });
  if (duplicates.length) {
    const d = duplicates[0];
    addActivity(lead.id, 'duplicate_flag',
      `Possible duplicate of "${d.lead.company}" (#${d.lead.id}, ${d.confidence}): ${d.reasons.join('; ')}`, 'Duplicate check');
  }
  return { lead, created: true, missingOwner: !ownerName, duplicates };
}

const toSqlTime = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
