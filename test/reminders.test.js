import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
const db = await import('../src/db.js');
const { dueReminders, runReminders, reminderText } = await import('../src/reminders.js');

const at = (y, m, d, h = 10, min = 0) => new Date(y, m - 1, d, h, min);

test('reminds the owner on the due date, nudges once when 2 days late, never twice', async () => {
  const due = db.insertLead({ company: 'Numero AI', owner_slack_id: 'U1', owner_name: 'Arun', need: 'Brand identity',
    value: 700000, next_step: 'Get the brief', next_follow_up_at: at(2026, 10, 13).toISOString(), slack_permalink: 'https://slack/p1' });
  db.insertLead({ company: 'Lost Co', status: 'closed_lost', next_follow_up_at: at(2026, 10, 13).toISOString() });
  db.insertLead({ company: 'Later Co', next_follow_up_at: at(2026, 10, 20).toISOString() });

  assert.deepEqual(dueReminders(at(2026, 10, 13)).map((r) => [r.lead.company, r.kind]), [['Numero AI', 'due']]);

  const posted = [];
  const post = async (text) => posted.push(text);
  assert.equal(await runReminders({ now: at(2026, 10, 13, 8), post, appUrl: 'https://app' }), 0);   // before 09:30
  assert.equal(await runReminders({ now: at(2026, 10, 13, 9, 45), post, appUrl: 'https://app' }), 1);
  assert.equal(await runReminders({ now: at(2026, 10, 13, 15), post, appUrl: 'https://app' }), 0);  // already sent
  assert.match(posted[0], /^⏰ Follow-up due today · <@U1>/);
  assert.match(posted[0], /\*Numero AI\* · Brand identity · ₹7,00,000/);
  assert.match(posted[0], /<https:\/\/app\/#lead-\d+\|Open in dashboard> · <https:\/\/slack\/p1\|Original post>/);

  assert.equal(await runReminders({ now: at(2026, 10, 14, 10), post, appUrl: 'https://app' }), 0);  // 1 day late: quiet
  assert.equal(await runReminders({ now: at(2026, 10, 15, 10), post, appUrl: 'https://app' }), 1);  // 2 days: nudge
  assert.match(posted[1], /^🔴 Follow-up 2 days overdue/);
  assert.equal(await runReminders({ now: at(2026, 10, 16, 10), post, appUrl: 'https://app' }), 0);  // nudged already

  assert.ok(db.getLead(due.id).activities.some((a) => a.type === 'reminder'));
});

test('a deal with no owner asks who is taking it', () => {
  const text = reminderText({ lead: { id: 9, company: 'X' }, kind: 'due', daysLate: 0 }, 'https://app');
  assert.match(text, /No owner yet/);
});
