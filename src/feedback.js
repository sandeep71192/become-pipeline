// Feedback loop storage: roadmap status, feedback items moving through the
// Ask -> Decide -> Launch -> Test cycle, and weekly test-script results.
import { db } from './db.js';
import { ROADMAP, STAGE_KEYS, CYCLE, ROADMAP_STATUSES, SCENARIOS, PULSE_ACTIONS } from './plan.js';
import { scanDuplicates } from './duplicates.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS roadmap_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    slug       TEXT UNIQUE,
    horizon    TEXT NOT NULL,
    status     TEXT NOT NULL,
    title      TEXT NOT NULL,
    why        TEXT, what TEXT, metric TEXT,
    sort       INTEGER,
    updated_by TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS feedback (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    author        TEXT NOT NULL,
    page          TEXT,                 -- which tab it was raised from
    context       TEXT,                 -- e.g. "Deal #12 Skydo" or "Test T5"
    type          TEXT NOT NULL,
    impact        TEXT NOT NULL,
    text          TEXT NOT NULL,
    stage         TEXT NOT NULL DEFAULT 'ask',
    decision      TEXT,                 -- accepted | parked | declined
    decision_note TEXT,
    roadmap_id    INTEGER REFERENCES roadmap_items(id),
    scenario_id   TEXT,
    voters        TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS feedback_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    feedback_id INTEGER NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
    actor       TEXT,
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS test_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle       TEXT NOT NULL,
    scenario_id TEXT NOT NULL,
    tester      TEXT NOT NULL,
    result      TEXT NOT NULL,          -- pass | fail | skip
    note        TEXT,
    feedback_id INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (cycle, scenario_id, tester)
  );
`);

// Copy the roadmap from plan.js on first run (and add any new items later), keeping edited statuses.
const insertItem = db.prepare(`INSERT OR IGNORE INTO roadmap_items (slug, horizon, status, title, why, what, metric, sort)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
ROADMAP.forEach((r, i) => insertItem.run(r.slug, r.horizon, r.status, r.title, r.why, r.what, r.metric, i));

// ---------------------------------------------------------------- cycles

/** ISO week, e.g. { key: "2026-W40", from: Mon, to: Fri }. One feedback cycle = one week. */
export function cycleOf(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (day - 1));
  const friday = new Date(monday); friday.setDate(monday.getDate() + 4);
  const iso = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { key: `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, from: iso(monday), to: iso(friday) };
}

// ---------------------------------------------------------------- roadmap

export function listRoadmap() {
  const items = db.prepare(`SELECT * FROM roadmap_items ORDER BY sort, id`).all();
  const counts = new Map(db.prepare(`SELECT roadmap_id, COUNT(*) n FROM feedback WHERE roadmap_id IS NOT NULL GROUP BY roadmap_id`).all()
    .map((r) => [r.roadmap_id, r.n]));
  return items.map((i) => ({ ...i, feedback_count: counts.get(i.id) ?? 0 }));
}

export function updateRoadmapItem(id, { status, horizon }, actor) {
  const item = db.prepare(`SELECT * FROM roadmap_items WHERE id = ?`).get(id);
  if (!item) throw new Error('Roadmap item not found');
  if (status && !ROADMAP_STATUSES.some((s) => s.key === status)) throw new Error('Unknown status');
  if (horizon && !['now', 'next', 'later'].includes(horizon)) throw new Error('Unknown horizon');
  db.prepare(`UPDATE roadmap_items SET status = COALESCE(?, status), horizon = COALESCE(?, horizon),
    updated_by = ?, updated_at = datetime('now') WHERE id = ?`).run(status ?? null, horizon ?? null, actor, id);
  return db.prepare(`SELECT * FROM roadmap_items WHERE id = ?`).get(id);
}

// ---------------------------------------------------------------- feedback

const stageLabel = (k) => CYCLE.find((c) => c.key === k)?.label ?? (k === 'done' ? 'Done' : k);
const hydrate = (f) => f && { ...f, voters: JSON.parse(f.voters) };

export function listFeedback() {
  const items = db.prepare(`SELECT f.*, r.title AS roadmap_title FROM feedback f
    LEFT JOIN roadmap_items r ON r.id = f.roadmap_id ORDER BY f.id DESC`).all().map(hydrate);
  const events = db.prepare(`SELECT * FROM feedback_events ORDER BY id`).all();
  const byId = new Map(items.map((i) => [i.id, { ...i, events: [] }]));
  for (const e of events) byId.get(e.feedback_id)?.events.push(e);
  return [...byId.values()];
}

const logEvent = (id, actor, body) => db.prepare(`INSERT INTO feedback_events (feedback_id, actor, body) VALUES (?, ?, ?)`).run(id, actor, body);

export function createFeedback({ author, page, context, type, impact, text, scenario_id = null }) {
  if (!author?.trim()) throw new Error('Tell us who you are first.');
  if (!text?.trim()) throw new Error('Write what happened or what you need.');
  const { lastInsertRowid } = db.prepare(`INSERT INTO feedback (author, page, context, type, impact, text, scenario_id, voters)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(author.trim(), page ?? null, context ?? null, type || 'idea', impact || 'nice',
    text.trim(), scenario_id, JSON.stringify([author.trim()]));
  const id = Number(lastInsertRowid);
  logEvent(id, author.trim(), 'Raised');
  return id;
}

/**
 * Move an item through the cycle. Guard rails:
 * - leaving Decide needs a decision; "accepted" items need a roadmap link.
 * - parked / declined items go straight to Done with the reason recorded.
 * - only Test can close an accepted item, and "not fixed" sends it back to Ask.
 */
export function updateFeedback(id, patch, actor) {
  const f = hydrate(db.prepare(`SELECT * FROM feedback WHERE id = ?`).get(id));
  if (!f) throw new Error('Feedback not found');
  const next = { ...f };
  const notes = [];

  if (patch.vote) {
    const voters = new Set(f.voters);
    voters.has(actor) ? voters.delete(actor) : voters.add(actor);
    next.voters = [...voters];
    notes.push(voters.has(actor) ? '+1' : 'Removed +1');
  }
  if ('roadmap_id' in patch) { next.roadmap_id = patch.roadmap_id || null; }
  if (patch.decision) {
    if (!['accepted', 'parked', 'declined'].includes(patch.decision)) throw new Error('Unknown decision');
    if (patch.decision !== 'accepted' && !patch.decision_note?.trim()) throw new Error('Give a short reason when parking or declining.');
    if (patch.decision === 'accepted' && !next.roadmap_id) throw new Error('Link it to a roadmap item when accepting.');
    next.decision = patch.decision;
    next.decision_note = patch.decision_note?.trim() || null;
    next.stage = patch.decision === 'accepted' ? 'launch' : 'done';
    notes.push(`Decided: ${patch.decision}${next.decision_note ? ` (${next.decision_note})` : ''}`);
  }
  if (patch.stage && patch.stage !== next.stage) {
    if (!STAGE_KEYS.has(patch.stage)) throw new Error('Unknown stage');
    if (patch.stage === 'launch' && next.decision !== 'accepted') throw new Error('Decide first: accept it onto the roadmap.');
    if (patch.stage === 'done' && f.stage !== 'test' && next.decision === 'accepted') throw new Error('Accepted items close from Test, after the person who raised it confirms.');
    next.stage = patch.stage;
    notes.push(`Moved to ${stageLabel(patch.stage)}${patch.note ? `: ${patch.note}` : ''}`);
  }
  if (patch.verify) {
    if (f.stage !== 'test') throw new Error('Only items in Test can be verified.');
    if (patch.verify === 'works') { next.stage = 'done'; notes.push(`Verified working${patch.note ? `: ${patch.note}` : ''}`); }
    else { next.stage = 'ask'; next.decision = null; notes.push(`Still not right, back to Ask${patch.note ? `: ${patch.note}` : ''}`); }
  }

  db.prepare(`UPDATE feedback SET stage = ?, decision = ?, decision_note = ?, roadmap_id = ?, voters = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(next.stage, next.decision, next.decision_note, next.roadmap_id, JSON.stringify(next.voters), id);
  for (const n of notes) logEvent(id, actor, n);
  return hydrate(db.prepare(`SELECT * FROM feedback WHERE id = ?`).get(id));
}

// ---------------------------------------------------------------- test script

export function listResults(cycle) {
  return db.prepare(`SELECT * FROM test_results WHERE cycle = ? ORDER BY id`).all(cycle);
}

/** Record a tester's result. A failure also raises a "Broken" feedback item in Ask. */
export function recordResult({ cycle, scenario_id, tester, result, note }) {
  if (!tester?.trim()) throw new Error('Tell us who you are first.');
  const scenario = SCENARIOS.find((s) => s.id === scenario_id);
  if (!scenario) throw new Error('Unknown scenario');
  if (!['pass', 'fail', 'skip', 'clear'].includes(result)) throw new Error('Unknown result');
  if (result === 'clear') {
    db.prepare(`DELETE FROM test_results WHERE cycle = ? AND scenario_id = ? AND tester = ?`).run(cycle, scenario_id, tester);
    return null;
  }
  if (result === 'fail' && !note?.trim()) throw new Error('Say what went wrong so it can be fixed.');
  let feedbackId = null;
  if (result === 'fail') {
    feedbackId = createFeedback({ author: tester, page: 'roadmap', context: `Test ${scenario.id}: ${scenario.title}`,
      type: 'bug', impact: 'slows', text: note, scenario_id });
  }
  db.prepare(`INSERT INTO test_results (cycle, scenario_id, tester, result, note, feedback_id) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (cycle, scenario_id, tester) DO UPDATE SET result = excluded.result, note = excluded.note,
      feedback_id = COALESCE(excluded.feedback_id, test_results.feedback_id), created_at = datetime('now')`)
    .run(cycle, scenario_id, tester.trim(), result, note?.trim() || null, feedbackId);
  return { feedbackId };
}

// ---------------------------------------------------------------- health

/** Numbers the Friday Decide session looks at, computed from real usage. */
export function health(cycle) {
  const one = (sql, ...a) => Object.values(db.prepare(sql).get(...a))[0] ?? 0;
  const active = `FROM leads WHERE merged_into IS NULL`;
  const open = `${active} AND status NOT IN ('closed_lost', 'completed_project')`;
  const total = one(`SELECT COUNT(*) ${open}`);
  const captured = one(`SELECT COUNT(*) ${active} AND raw_message IS NOT NULL AND date(created_at) >= ?`, cycle.from);
  const fixed = one(`SELECT COUNT(DISTINCT l.id) FROM leads l JOIN activities a ON a.lead_id = l.id
    WHERE l.raw_message IS NOT NULL AND date(l.created_at) >= ? AND a.type = 'edit'
      AND a.body NOT LIKE 'Updated from%' AND julianday(a.created_at) - julianday(l.created_at) < 1`, cycle.from);
  const merges = one(`SELECT COUNT(*) FROM merges WHERE undone_at IS NULL AND date(merged_at) >= ?`, cycle.from);
  const dismissals = one(`SELECT COUNT(*) FROM dup_dismissals WHERE reason != 'Un-merged' AND date(decided_at) >= ?`, cycle.from);
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
  return {
    openDeals: total,
    withOwner: pct(one(`SELECT COUNT(*) ${open} AND owner_name IS NOT NULL AND owner_name != ''`), total),
    withFollowUp: pct(one(`SELECT COUNT(*) ${open} AND next_follow_up_at IS NOT NULL`), total),
    overdue: one(`SELECT COUNT(*) ${open} AND next_follow_up_at < ?`, new Date().toISOString()),
    capturedThisCycle: captured,
    parserFixRate: pct(fixed, captured),
    duplicateQueue: scanDuplicates().length,
    merges,
    falseAlarmRate: pct(dismissals, merges + dismissals),
    pulseUpRate: (() => {
      const r = db.prepare(`SELECT SUM(thumbs = 1) up, SUM(thumbs = -1) down FROM pulses WHERE date(created_at) >= ?`).get(cycle.from);
      return r.up + r.down ? Math.round((r.up / (r.up + r.down)) * 100) : null;
    })(),
    feedbackByStage: Object.fromEntries(db.prepare(`SELECT stage, COUNT(*) n FROM feedback GROUP BY stage`).all().map((r) => [r.stage, r.n])),
  };
}

// ---------------------------------------------------------------- after-action pulses
// A tiny check shown after an action: 👍/👎 → how accurate → how to improve. Each level is
// optional; the row is created when the prompt is shown so we also learn the response rate.

db.exec(`
  CREATE TABLE IF NOT EXISTS pulses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action      TEXT NOT NULL,
    page        TEXT,
    context     TEXT,
    author      TEXT,
    status      TEXT NOT NULL DEFAULT 'shown',   -- shown | answered | dismissed | ignored | muted
    thumbs      INTEGER,                         -- 1 | -1
    accuracy    INTEGER,                         -- 1..5
    issues      TEXT NOT NULL DEFAULT '[]',
    comment     TEXT,
    feedback_id INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const PULSE_STATUSES = new Set(['shown', 'answered', 'dismissed', 'ignored', 'muted']);
// Which feedback type a thumbs-down with a comment becomes when promoted to Ask.
const PULSE_TYPE = { lead_create: 'data', dup_warning: 'data', dup_merge: 'data', hubspot_import: 'data' };

export function createPulse({ action, page, context, author }) {
  if (!action) throw new Error('Missing action');
  const { lastInsertRowid } = db.prepare(`INSERT INTO pulses (action, page, context, author) VALUES (?, ?, ?, ?)`)
    .run(String(action).slice(0, 40), page ?? null, context ?? null, author || null);
  return { id: Number(lastInsertRowid) };
}

export function updatePulse(id, patch) {
  const p = db.prepare(`SELECT * FROM pulses WHERE id = ?`).get(id);
  if (!p) throw new Error('Pulse not found');
  const actionLabel = PULSE_ACTIONS[p.action]?.label;
  const next = { ...p, issues: JSON.parse(p.issues) };
  if (patch.status) {
    if (!PULSE_STATUSES.has(patch.status)) throw new Error('Unknown status');
    // Never downgrade an answer to "dismissed" just because the card was closed afterwards.
    if (!(p.status === 'answered' && patch.status !== 'answered')) next.status = patch.status;
  }
  if (patch.thumbs !== undefined) { next.thumbs = patch.thumbs === 1 ? 1 : patch.thumbs === -1 ? -1 : null; next.status = 'answered'; }
  if (patch.accuracy !== undefined) {
    const a = Number(patch.accuracy);
    next.accuracy = a >= 1 && a <= 5 ? a : null;
    next.status = 'answered';
  }
  if (Array.isArray(patch.issues)) next.issues = patch.issues.map(String).slice(0, 10);
  if (patch.comment !== undefined) next.comment = String(patch.comment).trim().slice(0, 2000) || null;

  // A thumbs-down that comes with words is a real problem report: put it straight into Ask.
  if (next.thumbs === -1 && next.comment && !p.feedback_id) {
    next.feedback_id = createFeedback({
      author: next.author || 'Anonymous', page: next.page, context: `After “${actionLabel || next.action}”${next.context ? ` · ${next.context}` : ''}`,
      type: PULSE_TYPE[next.action] ?? 'friction', impact: next.accuracy && next.accuracy <= 2 ? 'blocks' : 'slows',
      text: next.comment + (next.issues.length ? `\n(What was off: ${next.issues.join(', ')})` : ''),
    });
  }
  db.prepare(`UPDATE pulses SET status = ?, thumbs = ?, accuracy = ?, issues = ?, comment = ?, feedback_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(next.status, next.thumbs, next.accuracy, JSON.stringify(next.issues), next.comment, next.feedback_id ?? p.feedback_id, id);
  return { ...db.prepare(`SELECT * FROM pulses WHERE id = ?`).get(id), promoted: Boolean(next.feedback_id && !p.feedback_id) };
}

/** Per-action roll-up for the Roadmap tab. */
export function pulseSummary() {
  const rows = db.prepare(`SELECT * FROM pulses ORDER BY id DESC`).all().map((r) => ({ ...r, issues: JSON.parse(r.issues) }));
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.action)) by.set(r.action, { action: r.action, shown: 0, answered: 0, up: 0, down: 0, accSum: 0, accN: 0, muted: 0, issues: {}, comments: [] });
    const s = by.get(r.action);
    s.shown++;
    if (r.status === 'answered') s.answered++;
    if (r.status === 'muted') s.muted++;
    if (r.thumbs === 1) s.up++;
    if (r.thumbs === -1) s.down++;
    if (r.accuracy) { s.accSum += r.accuracy; s.accN++; }
    for (const i of r.issues) s.issues[i] = (s.issues[i] ?? 0) + 1;
    if (r.comment && s.comments.length < 5) s.comments.push({ id: r.id, author: r.author, thumbs: r.thumbs, accuracy: r.accuracy, comment: r.comment, context: r.context, created_at: r.created_at, feedback_id: r.feedback_id });
  }
  const total = { shown: rows.length, answered: rows.filter((r) => r.status === 'answered').length,
    up: rows.filter((r) => r.thumbs === 1).length, down: rows.filter((r) => r.thumbs === -1).length };
  return {
    total,
    actions: [...by.values()].map((s) => ({
      action: s.action, shown: s.shown, answered: s.answered, muted: s.muted, up: s.up, down: s.down,
      responseRate: s.shown ? Math.round((s.answered / s.shown) * 100) : null,
      upRate: s.up + s.down ? Math.round((s.up / (s.up + s.down)) * 100) : null,
      accuracy: s.accN ? Math.round((s.accSum / s.accN) * 10) / 10 : null,
      topIssues: Object.entries(s.issues).sort((a, b) => b[1] - a[1]).slice(0, 3),
      comments: s.comments,
    })).sort((a, b) => (a.upRate ?? 101) - (b.upRate ?? 101)),
  };
}

/** Promote a pulse comment into the Ask column by hand (e.g. a thumbs-up with a good idea). */
export function promotePulse(id, actor) {
  const p = db.prepare(`SELECT * FROM pulses WHERE id = ?`).get(id);
  if (!p) throw new Error('Pulse not found');
  const actionLabel = PULSE_ACTIONS[p.action]?.label;
  if (p.feedback_id) return { feedback_id: p.feedback_id };
  if (!p.comment) throw new Error('Nothing to promote: this pulse has no comment.');
  const fid = createFeedback({ author: p.author || actor || 'Anonymous', page: p.page,
    context: `After “${actionLabel || p.action}”${p.context ? ` · ${p.context}` : ''}`,
    type: p.thumbs === 1 ? 'idea' : PULSE_TYPE[p.action] ?? 'friction', impact: p.thumbs === 1 ? 'nice' : 'slows', text: p.comment });
  db.prepare(`UPDATE pulses SET feedback_id = ? WHERE id = ?`).run(fid, id);
  return { feedback_id: fid };
}
