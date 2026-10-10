// Reverse flow: on a deal's follow-up date, post in the sales channel tagging its owner,
// with a link to the deal in the dashboard. One reminder on the due date, plus one nudge
// if the date passes by two days without being moved. Each is sent at most once.
import { db, listLeads } from './db.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    lead_id  INTEGER NOT NULL,
    due_date TEXT NOT NULL,          -- YYYY-MM-DD of the follow-up it was sent for
    kind     TEXT NOT NULL,          -- due | overdue
    sent_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (lead_id, due_date, kind)
  );
`);

const CLOSED = new Set(['closed_lost', 'completed_project', 'on_hold', 'project_on_hold']);
const SEND_AT = (process.env.REMINDER_TIME || '09:30').split(':').map(Number);   // local server time
const OVERDUE_AFTER_DAYS = 2;

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const money = (v) => (v ? `₹${new Intl.NumberFormat('en-IN').format(v)}` : null);

/** Reminders that should go out at `now` and haven't been sent yet. */
export function dueReminders(now = new Date()) {
  const today = ymd(now);
  const sent = new Set(db.prepare(`SELECT lead_id || ':' || due_date || ':' || kind AS k FROM reminders`).all().map((r) => r.k));
  const out = [];
  for (const lead of listLeads()) {
    if (!lead.next_follow_up_at || CLOSED.has(lead.status)) continue;
    const due = new Date(lead.next_follow_up_at);
    const dueDay = ymd(due);
    const daysLate = Math.round((new Date(today) - new Date(dueDay)) / 86400000);
    let kind = null;
    if (daysLate === 0) kind = 'due';
    else if (daysLate >= OVERDUE_AFTER_DAYS) kind = 'overdue';
    if (kind && !sent.has(`${lead.id}:${dueDay}:${kind}`)) out.push({ lead, kind, dueDay, daysLate });
  }
  return out;
}

/** The Slack message for one reminder (mrkdwn). */
export function reminderText({ lead, kind, daysLate }, appUrl) {
  const who = lead.owner_slack_id ? `<@${lead.owner_slack_id}>` : '*No owner yet*: who is taking this?';
  const head = kind === 'due'
    ? `⏰ Follow-up due today · ${who}`
    : `🔴 Follow-up ${daysLate} days overdue · ${who}`;
  const facts = [lead.contact_name, lead.need, money(lead.value)].filter(Boolean).join(' · ');
  const lines = [
    head,
    `*${lead.company}*${facts ? ` · ${facts}` : ''}`,
    lead.next_step ? `Next step: ${lead.next_step}` : null,
    `<${appUrl}/#lead-${lead.id}|Open in dashboard>${lead.slack_permalink ? ` · <${lead.slack_permalink}|Original post>` : ''}`,
    kind === 'due' ? '_Done? Move the stage or set the next date in the dashboard._' : '_Still open? Set a new follow-up date so it stops nudging._',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * Send whatever is due. `post(text, lead)` delivers one message; returns how many were sent.
 * Only runs at/after the configured time of day, so reminders land in the morning.
 */
export async function runReminders({ now = new Date(), post, appUrl, force = false }) {
  if (!force && (now.getHours() < SEND_AT[0] || (now.getHours() === SEND_AT[0] && now.getMinutes() < SEND_AT[1]))) return 0;
  let sent = 0;
  for (const r of dueReminders(now)) {
    try {
      await post(reminderText(r, appUrl), r.lead);
      db.prepare(`INSERT OR IGNORE INTO reminders (lead_id, due_date, kind) VALUES (?, ?, ?)`).run(r.lead.id, r.dueDay, r.kind);
      db.prepare(`INSERT INTO activities (lead_id, type, body, author) VALUES (?, 'reminder', ?, 'Reminder bot')`)
        .run(r.lead.id, r.kind === 'due' ? 'Follow-up reminder posted in Slack' : `Overdue nudge posted in Slack (${r.daysLate} days late)`);
      sent++;
    } catch (err) {
      console.warn(`[reminders] could not post for deal #${r.lead.id}:`, err.data?.error || err.message);
    }
  }
  return sent;
}
