import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const fb = await import('../src/feedback.js');
const { ROADMAP } = await import('../src/plan.js');

test('cycle is the ISO week, Monday to Friday', () => {
  assert.deepEqual(fb.cycleOf(new Date(2026, 8, 29)), { key: '2026-W40', from: '2026-09-28', to: '2026-10-02' });
  assert.equal(fb.cycleOf(new Date(2026, 9, 4)).key, '2026-W40');   // Sunday stays in the same week
  assert.equal(fb.cycleOf(new Date(2027, 0, 1)).key, '2026-W53');
});

test('roadmap is seeded once and status edits stick', () => {
  const items = fb.listRoadmap();
  assert.equal(items.length, ROADMAP.length);
  fb.updateRoadmapItem(items[0].id, { status: 'shipped' }, 'Arun');
  assert.equal(fb.listRoadmap()[0].status, 'shipped');
  assert.throws(() => fb.updateRoadmapItem(items[0].id, { status: 'bogus' }), /Unknown status/);
});

test('feedback moves Ask -> Decide -> Launch -> Test -> Done with guard rails', () => {
  const roadmapId = fb.listRoadmap()[1].id;
  const id = fb.createFeedback({ author: 'Priya', page: 'deals', type: 'friction', impact: 'slows', text: 'Too many clicks to log a call' });
  assert.throws(() => fb.updateFeedback(id, { stage: 'launch' }, 'Arun'), /Decide first/);
  fb.updateFeedback(id, { stage: 'decide' }, 'Arun');
  assert.throws(() => fb.updateFeedback(id, { decision: 'accepted' }, 'Arun'), /roadmap item/);
  assert.equal(fb.updateFeedback(id, { vote: true }, 'Arun').voters.length, 2);
  const accepted = fb.updateFeedback(id, { decision: 'accepted', roadmap_id: roadmapId }, 'Arun');
  assert.equal(accepted.stage, 'launch');
  assert.throws(() => fb.updateFeedback(id, { stage: 'done' }, 'Arun'), /close from Test/);
  fb.updateFeedback(id, { stage: 'test' }, 'Arun');
  assert.equal(fb.updateFeedback(id, { verify: 'broken', note: 'Still 4 clicks' }, 'Priya').stage, 'ask');
  const item = fb.listFeedback().find((f) => f.id === id);
  assert.deepEqual(item.events.map((e) => e.body), ['Raised', 'Moved to Decide', '+1', 'Decided: accepted', 'Moved to Test', 'Still not right, back to Ask: Still 4 clicks']);
  assert.equal(fb.listRoadmap()[1].feedback_count, 1);
});

test('parking needs a reason and closes the item', () => {
  const id = fb.createFeedback({ author: 'Neha', type: 'idea', impact: 'nice', text: 'Dark mode toggle' });
  assert.throws(() => fb.updateFeedback(id, { decision: 'parked' }, 'Arun'), /reason/);
  const f = fb.updateFeedback(id, { decision: 'parked', decision_note: 'Follows system setting already' }, 'Arun');
  assert.equal(f.stage, 'done');
});

test('a failed test raises a Broken feedback item; results are one per person per scenario', () => {
  assert.throws(() => fb.recordResult({ cycle: '2026-W40', scenario_id: 'T1', tester: 'Arun', result: 'fail' }), /what went wrong/);
  const { feedbackId } = fb.recordResult({ cycle: '2026-W40', scenario_id: 'T1', tester: 'Arun', result: 'fail', note: 'Role was blank' });
  const raised = fb.listFeedback().find((f) => f.id === feedbackId);
  assert.equal(raised.type, 'bug');
  assert.equal(raised.context, 'Test T1: Log a lead the way you post it in #sales');
  fb.recordResult({ cycle: '2026-W40', scenario_id: 'T1', tester: 'Arun', result: 'pass' });
  const results = fb.listResults('2026-W40');
  assert.equal(results.length, 1);
  assert.equal(results[0].result, 'pass');
  assert.equal(results[0].feedback_id, feedbackId);
});

test('health numbers compute on an empty pipeline', () => {
  const h = fb.health(fb.cycleOf());
  assert.equal(h.openDeals, 0);
  assert.equal(h.withOwner, null);
  assert.equal(h.feedbackByStage.ask, 2);
});

test('pulses: levels save independently, thumbs-down + comment goes to Ask, summary rolls up', () => {
  const { id } = fb.createPulse({ action: 'lead_create', page: 'deals', context: 'Deal #3 Skydo', author: 'Arun' });
  fb.updatePulse(id, { thumbs: -1 });
  fb.updatePulse(id, { accuracy: 2, issues: ['Owner', 'Follow-up date'] });
  const done = fb.updatePulse(id, { comment: 'Owner was the poster, not the tagged person' });
  assert.equal(done.promoted, true);
  const item = fb.listFeedback().find((f) => f.id === done.feedback_id);
  assert.equal(item.type, 'data');
  assert.equal(item.impact, 'blocks');
  assert.match(item.context, /After “Adding a lead” · Deal #3 Skydo/);
  assert.match(item.text, /What was off: Owner, Follow-up date/);
  assert.equal(fb.updatePulse(id, { status: 'dismissed' }).status, 'answered');   // closing after answering keeps the answer

  const up = fb.createPulse({ action: 'lead_create', author: 'Neha' });
  fb.updatePulse(up.id, { thumbs: 1, accuracy: 5 });
  fb.updatePulse(fb.createPulse({ action: 'lead_create' }).id, { status: 'ignored' });
  assert.throws(() => fb.promotePulse(up.id, 'Neha'), /no comment/);

  const s = fb.pulseSummary().actions.find((a) => a.action === 'lead_create');
  assert.deepEqual([s.shown, s.answered, s.up, s.down, s.upRate, s.accuracy, s.responseRate], [3, 2, 1, 1, 50, 3.5, 67]);
  assert.deepEqual(s.topIssues[0], ['Owner', 1]);
});
