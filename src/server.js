import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'node:url';
import {
  listLeads, getLead, updateLead, addActivity, EDITABLE_FIELDS, resolveId, learnCorrection,
  mergeLeads, undoMerge, dismissPair, undismissPair, listMerges, listDismissals,
} from './db.js';
import { parseLeadMessage } from './parser.js';
import { findDuplicates, scanDuplicates, flaggedLeads } from './duplicates.js';
import { STATUSES, STATUS_KEYS, statusLabel } from './statuses.js';
import { ingestMessage } from './ingest.js';
import { startSlack, slackEnabled, notifyThread, postToSalesChannel } from './slack.js';
import { dueReminders, reminderText, runReminders } from './reminders.js';
import { CYCLE, FEEDBACK_TYPES, IMPACTS, HORIZONS, ROADMAP_STATUSES, SCENARIOS, LENSES, OTHER_VOICES, NEXT_STEPS, PULSE_ACTIONS, PULSE_ACCURACY, BUILT } from './plan.js';
import { cycleOf, listRoadmap, updateRoadmapItem, listFeedback, createFeedback, updateFeedback, listResults, recordResult, health,
  createPulse, updatePulse, pulseSummary, promotePulse } from './feedback.js';
import { readSheet, suggestMapping, stageValues, importRows, checkRows, TARGETS, FIRST_LAST } from './hubspot.js';

const PORT = Number(process.env.PORT || 3000);
const app = express();
app.use(express.json({ limit: '50mb' }));

// Health check for the host (Railway). Before the password gate so it works unauthenticated.
app.get('/healthz', (_req, res) => res.json({ ok: true, slack: slackEnabled() }));

// Optional shared password for the whole app (HTTP Basic auth, any username).
if (process.env.APP_PASSWORD) {
  app.use((req, res, next) => {
    const [, b64] = (req.headers.authorization || '').split(' ');
    const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
    if (pass === process.env.APP_PASSWORD) return next();
    res.set('WWW-Authenticate', 'Basic realm="CRM"').status(401).send('Authentication required');
  });
}

app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.get('/api/meta', (_req, res) => res.json({ statuses: STATUSES, slack: slackEnabled() }));

app.get('/api/leads', (_req, res) => {
  const flags = flaggedLeads();
  res.json(listLeads().map((l) => ({ ...l, dup_level: flags.get(l.id) ?? 0 })));
});

app.get('/api/leads/:id', (req, res) => {
  // Old links to a merged-away lead land on the lead it was merged into.
  const id = resolveId(Number(req.params.id));
  const lead = id && getLead(id);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  res.json({ ...lead, duplicates: findDuplicates(lead) });
});

app.patch('/api/leads/:id', async (req, res) => {
  const id = Number(req.params.id);
  const before = getLead(id);
  if (!before) return res.status(404).json({ error: 'Not found' });

  const patch = Object.fromEntries(Object.entries(req.body).filter(([k]) => EDITABLE_FIELDS.has(k)));
  if (patch.status && !STATUS_KEYS.has(patch.status)) return res.status(400).json({ error: 'Unknown status' });
  if (patch.value !== undefined && patch.value !== null && patch.value !== '') patch.value = Number(patch.value);

  const lead = updateLead(id, patch);
  // Fixing a field on a lead captured from a post teaches the parser for next time.
  if (before.raw_message) for (const [k, v] of Object.entries(patch)) learnCorrection(k, before[k], v);
  if (patch.status && patch.status !== before.status) {
    const msg = `${statusLabel(before.status)} → ${statusLabel(patch.status)}`;
    addActivity(id, 'status_change', msg, req.body.actor || null);
    notifyThread(lead, `🔄 Stage moved: *${msg}*`);
  }
  for (const key of Object.keys(patch).filter((k) => k !== 'status' && String(before[k] ?? '') !== String(patch[k] ?? ''))) {
    addActivity(id, 'edit', `${key.replaceAll('_', ' ')}: ${patch[key] ?? '—'}`, req.body.actor || null);
  }
  res.json(getLead(id));
});

app.post('/api/leads/:id/notes', (req, res) => {
  const id = Number(req.params.id);
  if (!getLead(id)) return res.status(404).json({ error: 'Not found' });
  if (!req.body.body?.trim()) return res.status(400).json({ error: 'Empty note' });
  addActivity(id, 'note', req.body.body.trim(), req.body.actor || null);
  res.json(getLead(id));
});

// Paste a Slack message by hand (also handy for testing without Slack).
// Checks for duplicates first; the user then chooses: create anyway (force) or
// add the message to an existing deal (attachTo).
app.post('/api/import', async (req, res) => {
  const { text = '', force = false, attachTo = null, actor = null } = req.body;
  const parsed = parseLeadMessage(text);
  if (!parsed) return res.status(422).json({ error: 'Message must start with "New Lead/ <Company>" on the first line.' });

  if (attachTo) {
    const id = resolveId(Number(attachTo));
    if (!id) return res.status(404).json({ error: 'Deal not found' });
    addActivity(id, 'note', `New Lead message added here instead of creating a duplicate:\n${text}`, actor || 'Manual import');
    return res.json({ lead: getLead(id), attached: true });
  }
  if (!force) {
    const duplicates = findDuplicates(parsed);
    if (duplicates.length) return res.status(409).json({ company: parsed.company, duplicates });
  }
  const result = await ingestMessage({ text, postedBy: actor || 'Manual import' });
  res.status(201).json(result);
});

// ---------------------------------------------------------------- duplicates

app.get('/api/duplicates', (_req, res) => {
  res.json({ pairs: scanDuplicates(), merges: listMerges(30), dismissals: listDismissals(30) });
});

app.post('/api/duplicates/merge', (req, res) => {
  const { primaryId, secondaryId, choose = {}, actor = null } = req.body;
  try {
    res.json(mergeLeads(Number(primaryId), Number(secondaryId), choose, actor));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post('/api/duplicates/dismiss', (req, res) => {
  const { aId, bId, reason = null, actor = null } = req.body;
  dismissPair(Number(aId), Number(bId), reason, actor);
  const note = `Marked as not a duplicate of #${bId}${reason ? ` (${reason})` : ''}`;
  addActivity(Number(aId), 'duplicate_flag', note, actor);
  addActivity(Number(bId), 'duplicate_flag', `Marked as not a duplicate of #${aId}${reason ? ` (${reason})` : ''}`, actor);
  res.json({ ok: true });
});

app.post('/api/duplicates/undismiss', (req, res) => {
  undismissPair(Number(req.body.aId), Number(req.body.bId));
  res.json({ ok: true });
});

app.post('/api/merges/:id/undo', (req, res) => {
  try {
    res.json(undoMerge(Number(req.params.id), req.body?.actor ?? null));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// HubSpot export import, step 1: upload the file (raw body), get columns + suggested mapping.
app.post('/api/hubspot/preview', express.raw({ type: () => true, limit: '25mb' }), async (req, res) => {
  const filename = String(req.query.filename || 'export.xlsx');
  if (!req.body?.length) return res.status(400).json({ error: 'No file received.' });
  try {
    const { headers, rows } = await readSheet(req.body, filename);
    const { kind, mapping } = suggestMapping(headers);
    res.json({
      filename, kind, headers, rows, mapping,
      stages: stageValues(rows, mapping.status),
      targets: TARGETS.map(({ key, label }) => ({ key, label })),
      firstLast: FIRST_LAST,
    });
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// Distinct values of a column with suggested stages (when the user picks a different stage column).
app.post('/api/hubspot/stages', (req, res) => res.json(stageValues(req.body.rows || [], req.body.column)));

// Step 2: dry run - how each row would be matched, and which need a human decision.
app.post('/api/hubspot/check', (req, res) => {
  const { rows, mapping, stageMap, dateOrder } = req.body;
  try {
    res.json(checkRows(rows || [], { mapping, stageMap, dateOrder }));
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// Step 3: import the rows with the confirmed mapping and duplicate decisions.
app.post('/api/hubspot/import', (req, res) => {
  const { rows, mapping, stageMap, mode, dateOrder, filename, decisions } = req.body;
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No rows to import.' });
  try {
    res.json(importRows(rows, { mapping, stageMap, mode, dateOrder, filename, decisions }));
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// ---------------------------------------------------------------- roadmap & feedback loop

const team = () => {
  const fromEnv = (process.env.TEAM || '').split(',').map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : [...new Set(listLeads().map((l) => l.owner_name).filter(Boolean))].sort();
};

app.get('/api/plan', (req, res) => {
  const cycle = req.query.cycle ? { key: String(req.query.cycle) } : cycleOf();
  const current = cycleOf();
  res.json({
    cycle: cycle.key === current.key ? current : cycle, currentCycle: current.key,
    loop: CYCLE, feedbackTypes: FEEDBACK_TYPES, impacts: IMPACTS, horizons: HORIZONS, roadmapStatuses: ROADMAP_STATUSES,
    roadmap: listRoadmap(), scenarios: SCENARIOS, lenses: LENSES, otherVoices: OTHER_VOICES, nextSteps: NEXT_STEPS, built: BUILT,
    results: listResults(cycle.key), feedback: listFeedback(),
    pulseActions: PULSE_ACTIONS, pulseAccuracy: PULSE_ACCURACY, pulses: pulseSummary(), health: health(current), team: team(), slack: slackEnabled(),
  });
});

const guard = (fn) => (req, res) => {
  try { res.json(fn(req)); } catch (err) { res.status(422).json({ error: err.message }); }
};

app.patch('/api/roadmap/:id', guard((req) => updateRoadmapItem(Number(req.params.id), req.body, req.body.actor || null)));
app.post('/api/feedback', guard((req) => ({ id: createFeedback(req.body) })));
app.patch('/api/feedback/:id', guard((req) => {
  if (!req.body.actor?.trim()) throw new Error('Tell us who you are first.');
  return updateFeedback(Number(req.params.id), req.body, req.body.actor.trim());
}));
app.post('/api/pulses', guard((req) => createPulse(req.body)));
app.patch('/api/pulses/:id', guard((req) => updatePulse(Number(req.params.id), req.body)));
app.post('/api/pulses/:id/promote', guard((req) => promotePulse(Number(req.params.id), req.body.actor)));
app.post('/api/tests', guard((req) => recordResult({ ...req.body, cycle: req.body.cycle || cycleOf().key })));

// ---------------------------------------------------------------- reminders (reverse flow)

const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;
// Preview what today's reminders would say, without sending anything.
app.get('/api/reminders/preview', (_req, res) => {
  res.json(dueReminders().map((r) => ({ lead_id: r.lead.id, company: r.lead.company, kind: r.kind, text: reminderText(r, APP_URL) })));
});
// Send due reminders now (ignores the time-of-day window). Each reminder still goes out only once.
app.post('/api/reminders/run', async (_req, res) => {
  if (!slackEnabled()) return res.status(409).json({ error: 'Slack is not connected.' });
  res.json({ sent: await runReminders({ post: postToSalesChannel, appUrl: APP_URL, force: true }) });
});
if (process.env.REMINDERS !== 'off') {
  setInterval(() => {
    if (slackEnabled()) runReminders({ post: postToSalesChannel, appUrl: APP_URL }).catch((e) => console.warn('[reminders]', e.message));
  }, 5 * 60 * 1000);
}

app.listen(PORT, () => console.log(`[web] CRM running at http://localhost:${PORT}`));
startSlack().catch((err) => console.error('[slack] failed to start:', err.message));
