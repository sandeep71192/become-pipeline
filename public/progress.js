// How far a deal has got: our 16 stages grouped into 6 milestones, with the date each was reached.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const MILESTONES = [
  { key: 'lead',      label: 'Lead',      stages: ['deal_generated'] },
  { key: 'discovery', label: 'Discovery', stages: ['discovery_1', 'discovery_2'] },
  { key: 'proposal',  label: 'Proposal',  stages: ['proposal_1', 'proposal_2', 'follow_up_1', 'follow_up_2', 'follow_up_3'] },
  { key: 'closing',   label: 'Closing',   stages: ['finalising_terms', 'sow_msa'] },
  { key: 'project',   label: 'Project',   stages: ['active_project', 'project_on_hold'] },
  { key: 'delivered', label: 'Delivered', stages: ['completed_project', 'payment_follow_up'] },
];
const OFF_TRACK = { on_hold: 'paused', closed_lost: 'lost', project_on_hold: 'paused' };
const milestoneIndex = (status) => MILESTONES.findIndex((m) => m.stages.includes(status));
const sqlDate = (s) => new Date(s.includes('T') || s.endsWith('Z') ? s : `${s.replace(' ', 'T')}Z`);
const short = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
export const daysSince = (d) => Math.max(0, Math.floor((Date.now() - d) / 86400000));

/**
 * Stage history from the deal's activity log ("Proposal 1 → SoW & MSA" entries), oldest first.
 * Returns [{ status, at }] including the stage it started in.
 */
export function stageHistory(lead, statuses) {
  const byLabel = new Map(statuses.map((s) => [s.label, s.key]));
  const changes = (lead.activities || [])
    .filter((a) => a.type === 'status_change')
    .map((a) => {
      const [from, to] = a.body.replace(/\s*\(.*\)\s*$/, '').split(' → ').map((x) => x?.trim());
      return { from: byLabel.get(from), to: byLabel.get(to), at: sqlDate(a.created_at), id: a.id };
    })
    .filter((c) => c.to)
    .sort((a, b) => a.at - b.at || a.id - b.id);   // same-second changes: keep the order they were logged
  const first = changes[0]?.from ?? lead.status;
  return [{ status: first, at: sqlDate(lead.created_at) }, ...changes.map((c) => ({ status: c.to, at: c.at }))];
}

/** Summary used by the board card and the record header. */
export function progressOf(lead, statuses) {
  const off = OFF_TRACK[lead.status];
  const history = lead.activities ? stageHistory(lead, statuses) : null;
  // When paused or lost, show how far it got before that.
  let idx = milestoneIndex(lead.status);
  if (idx < 0 && history) {
    for (const h of [...history].reverse()) { const i = milestoneIndex(h.status); if (i >= 0) { idx = i; break; } }
  }
  if (idx < 0) idx = 0;
  const since = lead.stage_changed_at ? sqlDate(lead.stage_changed_at) : history?.at(-1)?.at ?? sqlDate(lead.created_at);
  return { idx, off, since, days: daysSince(since), label: statuses.find((s) => s.key === lead.status)?.label ?? lead.status };
}

/** Six small segments under a board card: how far along, and how long in the current stage. */
export function miniProgress(lead, statuses) {
  const p = progressOf(lead, statuses);
  const segs = MILESTONES.map((m, i) => `<i class="${i < p.idx ? 'done' : i === p.idx ? 'now' : ''}" title="${esc(m.label)}"></i>`).join('');
  return `<div class="mini-progress ${p.off ?? ''}" aria-label="${esc(`Milestone ${p.idx + 1} of 6: ${MILESTONES[p.idx].label}`)}">
    <div class="segs">${segs}</div>
    <span>${esc(p.off === 'lost' ? 'Lost' : p.off === 'paused' ? 'On hold' : MILESTONES[p.idx].label)} · ${p.days}d</span></div>`;
}

/** The stepper across the top of a record page, with the date each milestone was first reached. */
export function stepper(lead, statuses) {
  const p = progressOf(lead, statuses);
  const reached = new Map();
  for (const h of stageHistory(lead, statuses)) {
    const i = milestoneIndex(h.status);
    if (i >= 0 && !reached.has(i)) reached.set(i, h.at);
  }
  const steps = MILESTONES.map((m, i) => {
    const state = i < p.idx ? 'done' : i === p.idx ? 'now' : 'todo';
    const when = reached.get(i);
    return `<li class="step ${state}">
      <span class="dot" aria-hidden="true">${state === 'done' ? '✓' : i + 1}</span>
      <span class="name">${esc(m.label)}</span>
      <span class="when">${state === 'now' ? `${esc(p.label)} · ${p.days === 0 ? 'today' : `${p.days} day${p.days === 1 ? '' : 's'}`}` : when ? short(when) : ''}</span>
    </li>`;
  }).join('');
  const banner = p.off === 'lost' ? `<p class="track-flag lost">Closed / Lost · ${short(p.since)}</p>`
    : p.off === 'paused' ? `<p class="track-flag paused">On hold since ${short(p.since)}</p>` : '';
  return `<section class="stepper ${p.off ?? ''}" aria-label="Deal progress">${banner}<ol>${steps}</ol></section>`;
}
