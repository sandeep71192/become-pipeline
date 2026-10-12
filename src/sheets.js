// Mirror deals into the team's Google Sheet (the HubSpot deals export) while we transition.
// The app posts rows to a small Apps Script web app bound to the sheet (scripts/google-sheet-sync.gs),
// which adds or updates the row with the same Record ID. Off unless SHEETS_WEBHOOK_URL is set.
import { getRawLead, listLeads } from './db.js';

// Our stage keys -> HubSpot's stage names, so new rows read like the existing ones.
const HUBSPOT_STAGE = {
  deal_generated: 'Deal Generated', discovery_1: 'Discovery Call 1', discovery_2: 'Discovery Call 2',
  proposal_1: 'Proposal', proposal_2: 'Proposal', follow_up_1: 'Follow Up 1', follow_up_2: 'Follow Up 2',
  follow_up_3: 'Follow Up 3', finalising_terms: 'Finalising Terms', sow_msa: 'SoW & MSA', on_hold: 'On Hold',
  closed_lost: 'Closed lost', active_project: 'Active Project', project_on_hold: 'Project On Hold',
  completed_project: 'Completed Project', payment_follow_up: 'Payment Follow Up',
};
const CLOSED = new Set(['closed_lost', 'active_project', 'completed_project', 'payment_follow_up']);

const pad = (n) => String(n).padStart(2, '0');
// "2026-10-12 14:05" in the server's time zone (TZ=Asia/Kolkata on Railway), like the export.
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sqlDate = (s) => (s ? new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`) : null);

/** One sheet row for a deal. Columns A–G match the HubSpot export; H–M are extra context. */
export function toSheetRow(lead, appUrl) {
  const closeAt = CLOSED.has(lead.status) ? sqlDate(lead.updated_at) : null;
  return {
    record_id: lead.hubspot_id || `BP-${lead.id}`,
    deal_name: `${lead.company} | ${lead.need || 'TBD'}`,
    deal_stage: HUBSPOT_STAGE[lead.status] ?? lead.status,
    close_date: closeAt ? stamp(closeAt) : '',
    deal_owner: lead.owner_name || '',
    amount: lead.value ?? '',
    create_date: stamp(sqlDate(lead.created_at)),
    contact: [lead.contact_name, lead.contact_role].filter(Boolean).join(', '),
    next_step: lead.next_step || '',
    follow_up: lead.next_follow_up_at ? stamp(new Date(lead.next_follow_up_at)) : '',
    source: [lead.source_person, lead.source_event].filter(Boolean).join(', '),
    slack_link: lead.slack_permalink || '',
    pipeline_link: appUrl ? `${appUrl}/#lead-${lead.id}` : '',
  };
}

export const sheetsEnabled = () => Boolean(process.env.SHEETS_WEBHOOK_URL && process.env.SHEETS_SECRET);

async function send(rows) {
  const res = await fetch(process.env.SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: process.env.SHEETS_SECRET, rows }),
    redirect: 'follow',
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Sheet sync: unexpected reply (${res.status})`); }
  if (!body.ok) throw new Error(`Sheet sync: ${body.error || 'failed'}`);
  return body;
}

// Changes arrive in bursts (a new lead writes the deal plus its history): wait a moment, then send once.
const pending = new Map();
export function queueSheetSync(leadId, appUrl) {
  if (!sheetsEnabled() || !leadId) return;
  clearTimeout(pending.get(leadId));
  pending.set(leadId, setTimeout(async () => {
    pending.delete(leadId);
    const lead = getRawLead(leadId);
    if (!lead || lead.merged_into) return;
    try { await send([toSheetRow(lead, appUrl)]); }
    catch (err) { console.warn(`[sheets] deal #${leadId}:`, err.message); }
  }, 2000));
}

/** Push every open deal (first-time setup, or after the sheet was edited by hand). */
export async function syncAll(appUrl) {
  const rows = listLeads().map((l) => toSheetRow(l, appUrl));
  for (let i = 0; i < rows.length; i += 100) await send(rows.slice(i, i + 100));
  return rows.length;
}
