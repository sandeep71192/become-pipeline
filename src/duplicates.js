// Duplicate checks against the live pipeline.
import { Matcher } from './dedupe.js';
import { listLeads, dismissedKeys } from './db.js';

const CLOSED = new Set(['closed_lost', 'completed_project']);

const summary = (l) => ({
  id: l.id, company: l.company, contact_name: l.contact_name, contact_email: l.contact_email,
  owner_name: l.owner_name, owner_slack_id: l.owner_slack_id, status: l.status,
  created_at: l.created_at, hubspot_id: l.hubspot_id, slack_permalink: l.slack_permalink,
});

/** Leads that look like `candidate` (which may not be saved yet). */
export function findDuplicates(candidate, { excludeId = candidate.id ?? -1 } = {}) {
  const matcher = new Matcher(listLeads());
  return matcher.find({ ...candidate, id: excludeId }, { excludeId, dismissed: dismissedKeys() }).map((m) => ({
    ...m,
    lead: summary(m.lead),
    closed: CLOSED.has(m.lead.status),
  }));
}

/** Every open duplicate pair in the pipeline, best first. */
export function scanDuplicates() {
  const pairs = new Matcher(listLeads()).pairs(dismissedKeys());
  return pairs.map((p) => ({
    ...p,
    ownerConflict: Boolean(p.a.owner_name && p.b.owner_name && p.a.owner_name !== p.b.owner_name),
    repeatBusiness: CLOSED.has(p.a.status) !== CLOSED.has(p.b.status),
  }));
}

/** lead id -> strongest duplicate level, for badges on the board. */
export function flaggedLeads() {
  const flags = new Map();
  for (const p of scanDuplicates()) {
    for (const id of [p.a.id, p.b.id]) flags.set(id, Math.max(flags.get(id) ?? 0, p.level));
  }
  return flags;
}
