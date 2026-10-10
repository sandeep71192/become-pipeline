import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_STATUS } from './statuses.js';

const DB_PATH = process.env.DB_PATH || 'data/crm.db';
if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS leads (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    company          TEXT NOT NULL,
    contact_name     TEXT,
    contact_role     TEXT,
    need             TEXT,
    source_person    TEXT,
    source_event     TEXT,
    next_step        TEXT,
    next_follow_up_at TEXT,
    owner_slack_id   TEXT,
    owner_name       TEXT,
    status           TEXT NOT NULL DEFAULT '${DEFAULT_STATUS}',
    value            REAL,
    raw_message      TEXT,
    slack_channel    TEXT,
    slack_ts         TEXT UNIQUE,
    slack_permalink  TEXT,
    posted_by        TEXT,
    hubspot_id       TEXT,
    contact_email    TEXT,
    contact_phone    TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS activities (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,          -- created | status_change | slack_reply | note | edit
    body       TEXT,
    author     TEXT,
    slack_ts   TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Columns added after the first release; add them to older databases.
const existing = new Set(db.prepare(`PRAGMA table_info(leads)`).all().map((c) => c.name));
for (const [col, type] of [['hubspot_id', 'TEXT'], ['contact_email', 'TEXT'], ['contact_phone', 'TEXT'], ['merged_into', 'INTEGER']]) {
  if (!existing.has(col)) db.exec(`ALTER TABLE leads ADD COLUMN ${col} ${type}`);
}
db.exec(`
  CREATE INDEX IF NOT EXISTS leads_hubspot_id ON leads(hubspot_id);
  -- A merge hides the secondary lead (merged_into = primary) and records what changed on the
  -- primary, so it can be undone.
  CREATE TABLE IF NOT EXISTS merges (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    primary_id   INTEGER NOT NULL REFERENCES leads(id),
    secondary_id INTEGER NOT NULL REFERENCES leads(id),
    changes      TEXT NOT NULL,          -- JSON { field: [before, after] } on the primary
    merged_by    TEXT,
    merged_at    TEXT NOT NULL DEFAULT (datetime('now')),
    undone_at    TEXT,
    undone_by    TEXT
  );
  -- Pairs someone confirmed are NOT duplicates, so they stop being flagged.
  CREATE TABLE IF NOT EXISTS dup_dismissals (
    a_id       INTEGER NOT NULL,
    b_id       INTEGER NOT NULL,
    reason     TEXT,
    decided_by TEXT,
    decided_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (a_id, b_id)
  );
`);

const LEAD_FIELDS = [
  'company', 'contact_name', 'contact_role', 'need', 'source_person', 'source_event',
  'next_step', 'next_follow_up_at', 'owner_slack_id', 'owner_name', 'status', 'value',
  'raw_message', 'slack_channel', 'slack_ts', 'slack_permalink', 'posted_by',
  'hubspot_id', 'contact_email', 'contact_phone',
];
export const EDITABLE_FIELDS = new Set([
  'company', 'contact_name', 'contact_role', 'need', 'source_person', 'source_event',
  'next_step', 'next_follow_up_at', 'owner_name', 'status', 'value',
  'contact_email', 'contact_phone',
]);

/** Active leads only; merged-away leads are hidden. */
export function listLeads() {
  return db.prepare(`SELECT * FROM leads WHERE merged_into IS NULL ORDER BY datetime(created_at) DESC, id DESC`).all();
}

/** Follow merges to the surviving lead. */
export function resolveId(id) {
  let row = db.prepare(`SELECT id, merged_into FROM leads WHERE id = ?`).get(id);
  for (let hops = 0; row?.merged_into && hops < 20; hops++) {
    row = db.prepare(`SELECT id, merged_into FROM leads WHERE id = ?`).get(row.merged_into);
  }
  return row?.id ?? null;
}

// The lead plus every lead merged into it (recursively).
const FAMILY = `WITH RECURSIVE fam(id) AS (SELECT ? UNION SELECT l.id FROM leads l JOIN fam ON l.merged_into = fam.id)`;

export function getLead(id) {
  const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
  if (!lead) return null;
  lead.activities = db
    .prepare(`${FAMILY} SELECT * FROM activities WHERE lead_id IN (SELECT id FROM fam) ORDER BY datetime(created_at) DESC, id DESC`)
    .all(id);
  lead.merged = db
    .prepare(`${FAMILY} SELECT id, company, slack_permalink, hubspot_id, created_at FROM leads WHERE id IN (SELECT id FROM fam) AND id != ?`)
    .all(id, id);
  return lead;
}

export const getRawLead = (id) => db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);

/** Slack thread -> lead, following merges so replies land on the surviving lead. */
export function getLeadBySlackTs(ts) {
  const row = db.prepare(`SELECT id FROM leads WHERE slack_ts = ?`).get(ts);
  return row ? getRawLead(resolveId(row.id)) : undefined;
}

export function insertLead(data, createdNote = 'Lead created from Slack message') {
  const cols = LEAD_FIELDS.filter((f) => data[f] !== undefined && data[f] !== null);
  const created = data.created_at ? ', created_at' : '';
  const sql = `INSERT INTO leads (${cols.join(', ')}${created})
               VALUES (${cols.map(() => '?').join(', ')}${created ? ', ?' : ''})`;
  const args = cols.map((c) => data[c]);
  if (created) args.push(data.created_at);
  const { lastInsertRowid } = db.prepare(sql).run(...args);
  const id = Number(lastInsertRowid);
  addActivity(id, 'created', createdNote, data.posted_by, null, data.created_at);
  return getLead(id);
}

export function updateLead(id, patch) {
  const cols = Object.keys(patch).filter((k) => EDITABLE_FIELDS.has(k) || k === 'owner_slack_id' || k === 'hubspot_id');
  if (!cols.length) return getLead(id);
  db.prepare(`UPDATE leads SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...cols.map((c) => (patch[c] === '' ? null : patch[c])), id);
  return getLead(id);
}

export function addActivity(leadId, type, body, author = null, slackTs = null, createdAt = null) {
  db.prepare(
    `INSERT OR IGNORE INTO activities (lead_id, type, body, author, slack_ts, created_at)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  ).run(leadId, type, body, author, slackTs, createdAt);
}

// ---------------------------------------------------------------- duplicates

const MERGE_FIELDS = [...EDITABLE_FIELDS, 'hubspot_id', 'owner_slack_id'];
const FIELD_LABEL = { next_follow_up_at: 'follow-up date', contact_name: 'contact', contact_role: 'role',
  contact_email: 'email', contact_phone: 'phone', owner_name: 'owner', status: 'stage', value: 'deal value',
  source_person: 'source', source_event: 'source event', hubspot_id: 'HubSpot ID' };
const fieldLabel = (f) => FIELD_LABEL[f] ?? f.replaceAll('_', ' ');
const empty = (v) => v === null || v === undefined || v === '';

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/**
 * Merge `secondaryId` into `primaryId`.
 * @param {object} choose  { field: 'secondary' } for fields where the secondary's value should win.
 *                         Other fields keep the primary's value, and blanks are filled from the secondary.
 */
export function mergeLeads(primaryId, secondaryId, choose = {}, actor = null) {
  const p = getRawLead(primaryId), s = getRawLead(secondaryId);
  if (!p || !s) throw new Error('Lead not found');
  if (p.id === s.id) throw new Error('Cannot merge a lead into itself');
  if (p.merged_into || s.merged_into) throw new Error('One of these leads was already merged');

  const patch = {};
  for (const f of MERGE_FIELDS) {
    if (f === 'owner_slack_id') continue;                     // follows owner_name below
    if (f === 'hubspot_id' && !empty(p.hubspot_id)) continue; // never overwrite a record link
    const wantSecondary = choose[f] === 'secondary' && !empty(s[f]);
    if ((wantSecondary || empty(p[f])) && !empty(s[f]) && String(s[f]) !== String(p[f] ?? '')) patch[f] = s[f];
  }
  if ('owner_name' in patch) patch.owner_slack_id = s.owner_slack_id;
  const changes = Object.fromEntries(Object.keys(patch).map((f) => [f, [p[f] ?? null, patch[f]]]));

  return tx(() => {
    if (Object.keys(patch).length) {
      db.prepare(`UPDATE leads SET ${Object.keys(patch).map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...Object.values(patch), p.id);
    }
    db.prepare(`UPDATE leads SET merged_into = ?, updated_at = datetime('now') WHERE id = ?`).run(p.id, s.id);
    const { lastInsertRowid } = db.prepare(`INSERT INTO merges (primary_id, secondary_id, changes, merged_by) VALUES (?, ?, ?, ?)`)
      .run(p.id, s.id, JSON.stringify(changes), actor);
    const changed = Object.keys(changes).filter((f) => f !== 'owner_slack_id').map(fieldLabel);
    addActivity(p.id, 'merge', `Merged duplicate "${s.company}" (#${s.id}) into this deal${changed.length ? `. Took: ${changed.join(', ')}` : ''}.` +
      (s.hubspot_id && p.hubspot_id && s.hubspot_id !== p.hubspot_id ? ` Its HubSpot record ${s.hubspot_id} is noted here.` : ''), actor);
    return { mergeId: Number(lastInsertRowid), lead: getLead(p.id) };
  });
}

/** Undo a merge: un-hide the secondary and restore primary fields the merge changed (unless edited since). */
export function undoMerge(mergeId, actor = null) {
  const m = db.prepare(`SELECT * FROM merges WHERE id = ?`).get(mergeId);
  if (!m) throw new Error('Merge not found');
  if (m.undone_at) throw new Error('This merge was already undone');
  const s = getRawLead(m.secondary_id);
  if (s.merged_into !== m.primary_id) throw new Error('The merged lead has moved since; undo the later merge first');
  const p = getRawLead(m.primary_id);
  if (p.merged_into) throw new Error('The surviving lead was itself merged later; undo that merge first');

  const changes = JSON.parse(m.changes);
  const restore = {}, kept = [];
  for (const [f, [before, after]] of Object.entries(changes)) {
    if (String(p[f] ?? '') === String(after ?? '')) restore[f] = before;
    else if (f !== 'owner_slack_id') kept.push(fieldLabel(f));
  }
  return tx(() => {
    if (Object.keys(restore).length) {
      db.prepare(`UPDATE leads SET ${Object.keys(restore).map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...Object.values(restore), p.id);
    }
    db.prepare(`UPDATE leads SET merged_into = NULL, updated_at = datetime('now') WHERE id = ?`).run(s.id);
    db.prepare(`UPDATE merges SET undone_at = datetime('now'), undone_by = ? WHERE id = ?`).run(actor, m.id);
    const note = kept.length ? ` Kept later edits to: ${kept.join(', ')}.` : '';
    addActivity(p.id, 'merge', `Undid merge with "${s.company}" (#${s.id}).${note}`, actor);
    addActivity(s.id, 'merge', `Restored: un-merged from "${p.company}" (#${p.id}).`, actor);
    // Don't immediately re-flag a pair someone just split apart on purpose.
    dismissPair(p.id, s.id, 'Un-merged', actor);
    return { primary: getLead(p.id), secondary: getLead(s.id), kept };
  });
}

export function dismissPair(aId, bId, reason = null, actor = null) {
  const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
  db.prepare(`INSERT OR REPLACE INTO dup_dismissals (a_id, b_id, reason, decided_by) VALUES (?, ?, ?, ?)`).run(a, b, reason, actor);
}

export function undismissPair(aId, bId) {
  const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
  db.prepare(`DELETE FROM dup_dismissals WHERE a_id = ? AND b_id = ?`).run(a, b);
}

export const dismissedKeys = () =>
  new Set(db.prepare(`SELECT a_id, b_id FROM dup_dismissals`).all().map((r) => `${r.a_id}:${r.b_id}`));

export function listDismissals(limit = 50) {
  return db.prepare(`
    SELECT d.*, la.company AS a_company, lb.company AS b_company FROM dup_dismissals d
    JOIN leads la ON la.id = d.a_id JOIN leads lb ON lb.id = d.b_id
    ORDER BY datetime(d.decided_at) DESC LIMIT ?`).all(limit);
}

export function listMerges(limit = 50) {
  return db.prepare(`
    SELECT m.*, p.company AS primary_company, s.company AS secondary_company FROM merges m
    JOIN leads p ON p.id = m.primary_id JOIN leads s ON s.id = m.secondary_id
    ORDER BY m.id DESC LIMIT ?`).all(limit);
}

// ---------------------------------------------------------------- learned corrections
// When someone fixes a field the parser got wrong, remember it and apply it to future posts.
db.exec(`
  CREATE TABLE IF NOT EXISTS parse_corrections (
    field      TEXT NOT NULL,
    from_key   TEXT NOT NULL,
    to_value   TEXT NOT NULL,
    times      INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (field, from_key)
  );
`);
export const LEARNED_FIELDS = new Set(['company', 'need', 'contact_name', 'contact_role']);
const corrKey = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function learnCorrection(field, fromValue, toValue) {
  if (!LEARNED_FIELDS.has(field) || !fromValue || !toValue || corrKey(fromValue) === corrKey(toValue)) return;
  db.prepare(`INSERT INTO parse_corrections (field, from_key, to_value) VALUES (?, ?, ?)
    ON CONFLICT (field, from_key) DO UPDATE SET to_value = excluded.to_value, times = times + 1, updated_at = datetime('now')`)
    .run(field, corrKey(fromValue), toValue);
}

/** Apply learned corrections to freshly parsed fields; returns the list of fields changed. */
export function applyCorrections(fields) {
  const changed = [];
  for (const field of LEARNED_FIELDS) {
    if (!fields[field]) continue;
    const row = db.prepare(`SELECT to_value FROM parse_corrections WHERE field = ? AND from_key = ?`).get(field, corrKey(fields[field]));
    if (row) { fields[field] = row.to_value; changed.push(field); }
  }
  return changed;
}
