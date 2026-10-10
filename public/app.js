import { initHubspotImport } from './hubspot-import.js';
import { initDuplicates } from './duplicates.js';
import { initRoadmap } from './roadmap.js';
import { initFeedbackWidget } from './feedback-widget.js';
import { initMe, getMe, onMeOpen } from './me.js';
import { createPulse } from './pulse.js';
import { toast } from './feedback-widget.js';

/** Modules announce finished actions; the pulse decides whether to ask about them. */
const actionDone = (action, context = '') => window.dispatchEvent(new CustomEvent('action:done', { detail: { action, context } }));
const dealCtx = (id) => { const l = state.leads.find((x) => x.id === id); return `Deal #${id}${l ? ` ${l.company}` : ''}`; };

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  statuses: [],
  leads: [],
  view: localGet('view', 'board'),
  pipeline: localGet('pipeline', 'sales'),
  owner: '',
  due: '',
  q: '',
  sort: { key: 'next_follow_up_at', asc: true },
  openId: null,
};

function localGet(k, d) { try { return localStorage.getItem(`crm.${k}`) ?? d; } catch { return d; } }
function localSet(k, v) { try { localStorage.setItem(`crm.${k}`, v); } catch {} }

const api = async (path, opts = {}) => {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body && JSON.stringify(opts.body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  return data;
};

// ---------- formatting ----------
const money = (v) => (v == null ? '' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v));
const statusLabel = (k) => state.statuses.find((s) => s.key === k)?.label ?? k;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function dueInfo(iso) {
  if (!iso) return { cls: '', text: 'No follow-up', bucket: 'none' };
  const days = Math.round((startOfDay(iso) - startOfDay(new Date())) / 86400000);
  const date = new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (days < 0) return { cls: 'overdue', text: `Overdue · ${date}`, bucket: 'overdue' };
  if (days === 0) return { cls: 'today', text: 'Today', bucket: 'today' };
  if (days === 1) return { cls: 'soon', text: 'Tomorrow', bucket: 'week' };
  if (days <= 7) return { cls: 'soon', text: new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), bucket: 'week' };
  return { cls: '', text: date, bucket: 'later' };
}

// Become palette (from become.team)
const COLORS = ['#5460e0', '#6677af', '#8a59b5', '#b88e44', '#df465c', '#151515', '#3d7d86'];
function avatar(name) {
  if (!name) return `<span class="avatar none" title="No owner tagged">?</span>`;
  const hue = COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="avatar" style="background:${hue}" title="${esc(name)}">${esc(initials)}</span>`;
}

// ---------- filtering ----------
function visibleStatuses() {
  return state.pipeline === 'all' ? state.statuses : state.statuses.filter((s) => s.pipeline === state.pipeline);
}

function filteredLeads() {
  const keys = new Set(visibleStatuses().map((s) => s.key));
  const q = state.q.toLowerCase();
  return state.leads.filter((l) => {
    if (!keys.has(l.status)) return false;
    if (state.owner === '__none' ? l.owner_name : state.owner && l.owner_name !== state.owner) return false;
    if (state.due) {
      const b = dueInfo(l.next_follow_up_at).bucket;
      const match = state.due === 'week' ? b === 'today' || b === 'week' : b === state.due;
      if (!match) return false;
    }
    if (q && ![l.company, l.contact_name, l.need, l.source_person, l.source_event, l.next_step].some((f) => f?.toLowerCase().includes(q))) return false;
    return true;
  });
}

// ---------- render ----------
function render() {
  document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  $('#board').hidden = state.view !== 'board';
  $('#list').hidden = state.view !== 'list';
  $('#pipeline').value = state.pipeline;

  const leads = filteredLeads();
  const open = leads.filter((l) => !['closed_lost', 'completed_project'].includes(l.status));
  const overdue = leads.filter((l) => dueInfo(l.next_follow_up_at).bucket === 'overdue').length;
  const total = open.reduce((a, l) => a + (l.value || 0), 0);
  $('#summary').textContent = `${leads.length} deals · ${money(total) || '₹0'} open value · ${overdue} overdue follow-up${overdue === 1 ? '' : 's'}`;

  const owners = [...new Set(state.leads.map((l) => l.owner_name).filter(Boolean))].sort();
  $('#owner').innerHTML = `<option value="">All owners</option>${owners.map((o) => `<option ${o === state.owner ? 'selected' : ''}>${esc(o)}</option>`).join('')}<option value="__none" ${state.owner === '__none' ? 'selected' : ''}>No owner</option>`;

  state.view === 'board' ? renderBoard(leads) : renderList(leads);
}

function cardHTML(l) {
  const due = dueInfo(l.next_follow_up_at);
  const contact = [l.contact_name, l.contact_role].filter(Boolean).join(' · ');
  return `<article class="card" draggable="true" data-id="${l.id}">
    ${l.dup_level ? `<span class="dupchip" title="Looks like another deal. Review under Duplicates">⚠ Possible duplicate</span>` : ''}
    <div class="card-co">${esc(l.company)}</div>
    ${contact ? `<div class="card-line">${esc(contact)}</div>` : ''}
    ${l.need ? `<div class="card-line">${esc(l.need)}${l.value ? ` · ${money(l.value)}` : ''}</div>` : ''}
    ${l.next_step ? `<div class="card-line" title="Next step">→ ${esc(l.next_step)}</div>` : ''}
    <div class="card-foot"><span class="chip ${due.cls}">${esc(due.text)}</span>${avatar(l.owner_name)}</div>
  </article>`;
}

function renderBoard(leads) {
  $('#board').innerHTML = visibleStatuses().map((s) => {
    const items = leads.filter((l) => l.status === s.key);
    const sum = items.reduce((a, l) => a + (l.value || 0), 0);
    return `<div class="col">
      <div class="col-head">
        <div class="col-title"><span>${esc(s.label)}</span><span class="col-count">${items.length}</span></div>
        <div class="col-sum">${sum ? money(sum) : '&nbsp;'}</div>
      </div>
      <div class="col-body" data-status="${s.key}">${items.map(cardHTML).join('')}</div>
    </div>`;
  }).join('');
}

const COLUMNS = [
  ['company', 'Company'], ['contact_name', 'Contact'], ['need', 'Need'], ['status', 'Stage'],
  ['owner_name', 'Owner'], ['next_step', 'Next step'], ['next_follow_up_at', 'Follow-up'],
  ['source_person', 'Source'], ['value', 'Value'], ['created_at', 'Created'],
];

function renderList(leads) {
  if (!leads.length) { $('#list').innerHTML = `<div class="empty">No deals match these filters.</div>`; return; }
  const { key, asc } = state.sort;
  const order = new Map(state.statuses.map((s, i) => [s.key, i]));
  const val = (l) => (key === 'status' ? order.get(l.status) : l[key]);
  const sorted = [...leads].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * (asc ? 1 : -1);
  });
  const opts = (cur) => state.statuses.map((s) => `<option value="${s.key}" ${s.key === cur ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
  $('#list').innerHTML = `<table>
    <thead><tr>${COLUMNS.map(([k, t]) => `<th data-sort="${k}" class="${k === key ? `sorted ${asc ? 'asc' : ''}` : ''}">${t}</th>`).join('')}</tr></thead>
    <tbody>${sorted.map((l) => {
      const due = dueInfo(l.next_follow_up_at);
      return `<tr data-id="${l.id}">
        <td class="co">${esc(l.company)}${l.dup_level ? ' <span class="dupchip" title="Possible duplicate">⚠</span>' : ''}</td>
        <td>${esc([l.contact_name, l.contact_role].filter(Boolean).join(', '))}</td>
        <td>${esc(l.need)}</td>
        <td><select data-status-for="${l.id}" aria-label="Stage">${opts(l.status)}</select></td>
        <td><span class="owner">${avatar(l.owner_name)} ${esc(l.owner_name || 'Unassigned')}</span></td>
        <td>${esc(l.next_step)}</td>
        <td><span class="chip ${due.cls}">${esc(due.text)}</span></td>
        <td>${esc([l.source_person, l.source_event].filter(Boolean).join(' · '))}</td>
        <td>${money(l.value)}</td>
        <td>${new Date(l.created_at + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

// ---------- drawer ----------
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

async function openLead(id) {
  state.openId = id;
  if (location.hash !== `#lead-${id}`) history.replaceState(null, '', `#lead-${id}`);
  const l = await api(`/api/leads/${id}`);
  if (l.id !== id) { state.openId = l.id; history.replaceState(null, '', `#lead-${l.id}`); }   // was merged into l
  const field = (k, label, type = 'text', full = false) =>
    `<label class="${full ? 'full' : ''}">${label}<input data-field="${k}" type="${type}" value="${esc(type === 'datetime-local' ? toLocalInput(l[k]) : l[k])}"></label>`;
  $('#drawer').innerHTML = `
    <div class="drawer-head">
      <div><h2>${esc(l.company)}</h2><p class="sub">Created ${new Date(l.created_at + 'Z').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}${l.posted_by ? ` by ${esc(l.posted_by)}` : ''}</p></div>
      <button class="close" aria-label="Close">×</button>
    </div>
    ${l.slack_permalink ? `<a class="link" href="${esc(l.slack_permalink)}" target="_blank" rel="noopener">Open Slack thread ↗</a>` : ''}
    ${l.duplicates.length ? `<div class="dup-warn"><strong>⚠ May be a duplicate of:</strong>
      ${l.duplicates.slice(0, 3).map((d) => `<div class="m"><span><a class="link" href="#lead-${d.lead.id}">${esc(d.lead.company)}</a>
        <span class="conf ${d.confidence}">${d.confidence}</span><br><span class="sub">${esc(d.reasons.join(' · '))} · owner ${esc(d.lead.owner_name || 'none')}</span></span></div>`).join('')}
      <a class="link" href="#duplicates">Compare &amp; merge →</a></div>` : ''}
    ${l.merged.length ? `<p class="sub small">Merged in: ${l.merged.map((m) => `${esc(m.company)} (#${m.id})${m.slack_permalink ? ` · <a class="link" href="${esc(m.slack_permalink)}" target="_blank" rel="noopener">Slack</a>` : ''}`).join(', ')}</p>` : ''}
    <div class="fields">
      <label class="full">Stage<select data-field="status">${state.statuses.map((s) => `<option value="${s.key}" ${s.key === l.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
      ${field('owner_name', 'Owner')}
      ${field('value', 'Deal value (₹)', 'number')}
      ${field('contact_name', 'Contact')}
      ${field('contact_role', 'Role')}
      ${field('contact_email', 'Email', 'email')}
      ${field('contact_phone', 'Phone', 'tel')}
      ${field('need', 'Need', 'text', true)}
      ${field('next_step', 'Next step')}
      ${field('next_follow_up_at', 'Follow-up on', 'datetime-local')}
      ${field('source_person', 'Source')}
      ${field('source_event', 'Source event / company')}
    </div>
    <div class="saved" id="saved"></div>
    <div class="section-title">Add note</div>
    <form class="note-form" id="noteForm"><textarea placeholder="Called Diya, sending proposal Wednesday…" required></textarea><button class="btn">Add</button></form>
    <div class="section-title">Activity</div>
    <ul class="timeline">${l.activities.map((a) => `<li class="${a.type}">
      <div class="tl-meta">${esc(a.type.replaceAll('_', ' '))} · ${esc(a.author || 'System')} · ${new Date(a.created_at + 'Z').toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
      <div class="tl-body">${esc(a.body)}</div></li>`).join('')}</ul>
    ${l.raw_message ? `<div class="section-title">Original Slack message</div><div class="raw">${esc(l.raw_message)}</div>` : ''}`;
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
}

function closeDrawer() {
  state.openId = null;
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
  history.replaceState(null, '', location.pathname);
}


async function patchLead(id, patch) {
  const updated = await api(`/api/leads/${id}`, { method: 'PATCH', body: { ...patch, actor: getMe() || null } });
  const i = state.leads.findIndex((l) => l.id === id);
  if (i >= 0) state.leads[i] = { ...state.leads[i], ...updated };
  render();
  return updated;
}

// ---------- events ----------
document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; localSet('view', state.view); render(); }));
$('#pipeline').addEventListener('change', (e) => { state.pipeline = e.target.value; localSet('pipeline', state.pipeline); render(); });
$('#owner').addEventListener('change', (e) => { state.owner = e.target.value; render(); });
$('#due').addEventListener('change', (e) => { state.due = e.target.value; render(); });
$('#search').addEventListener('input', (e) => { state.q = e.target.value; render(); });

// drag & drop on the board
let dragId = null;
$('#board').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  dragId = Number(card.dataset.id); card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
$('#board').addEventListener('dragend', (e) => { e.target.closest('.card')?.classList.remove('dragging'); document.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop')); });
$('#board').addEventListener('dragover', (e) => {
  const col = e.target.closest('.col-body'); if (!col || dragId == null) return;
  e.preventDefault();
  document.querySelectorAll('.drop').forEach((x) => x !== col && x.classList.remove('drop'));
  col.classList.add('drop');
});
$('#board').addEventListener('drop', async (e) => {
  const col = e.target.closest('.col-body'); if (!col || dragId == null) return;
  e.preventDefault();
  const id = dragId; dragId = null;
  const lead = state.leads.find((l) => l.id === id);
  if (lead && lead.status !== col.dataset.status) {
    lead.status = col.dataset.status; render();       // optimistic
    await patchLead(id, { status: col.dataset.status })
      .then(() => actionDone('stage_move', dealCtx(id)))
      .catch((err) => { alert(err.message); load(); });
  }
});
$('#board').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openLead(Number(c.dataset.id)); });

$('#list').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (th) { const k = th.dataset.sort; state.sort = { key: k, asc: state.sort.key === k ? !state.sort.asc : true }; return render(); }
  if (e.target.closest('select')) return;
  const tr = e.target.closest('tr[data-id]'); if (tr) openLead(Number(tr.dataset.id));
});
$('#list').addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-status-for]');
  if (sel) patchLead(Number(sel.dataset.statusFor), { status: sel.value }).then(() => actionDone('stage_move', dealCtx(Number(sel.dataset.statusFor))));
});

$('#drawer').addEventListener('click', (e) => { if (e.target.closest('.close')) closeDrawer(); });
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });
$('#drawer').addEventListener('change', async (e) => {
  const el = e.target.closest('[data-field]'); if (!el || state.openId == null) return;
  let v = el.value;
  if (el.type === 'datetime-local') v = v ? new Date(v).toISOString() : null;
  const editedId = state.openId;
  await patchLead(editedId, { [el.dataset.field]: v });
  await openLead(editedId);
  $('#saved').textContent = 'Saved ✓';
  actionDone(el.dataset.field === 'status' ? 'stage_move' : 'deal_edit', dealCtx(editedId));
});
$('#drawer').addEventListener('submit', async (e) => {
  if (e.target.id !== 'noteForm') return;
  e.preventDefault();
  const body = $('textarea', e.target).value;
  await api(`/api/leads/${state.openId}/notes`, { method: 'POST', body: { body, actor: getMe() || null } });
  openLead(state.openId);
  actionDone('note_add', dealCtx(state.openId));
});

// import dialog
const dlg = $('#importDlg');
const resetImport = () => {
  $('#importErr').hidden = true;
  $('#importDupes').hidden = true;
  $('#importForce').hidden = true;
  $('#importSubmit').hidden = false;
};
$('#importBtn').addEventListener('click', () => { resetImport(); $('#importText').value = ''; dlg.showModal(); });
$('#importText').addEventListener('input', resetImport);
$('#importCancel').addEventListener('click', () => dlg.close());

async function submitImport(extra = {}) {
  try {
    const { lead } = await api('/api/import', { method: 'POST', body: { text: $('#importText').value, actor: getMe() || null, ...extra } });
    dlg.close();
    await load();
    dupes.load();
    openLead(lead.id);
    // After a duplicate warning, ask about the warning; otherwise about how the lead was read.
    actionDone(extra.force || extra.attachTo ? 'dup_warning' : 'lead_create', `Deal #${lead.id} ${lead.company}`);
  } catch (err) {
    if (err.status !== 409) { $('#importErr').textContent = err.message; $('#importErr').hidden = false; return; }
    // Duplicate check hit: let the person decide instead of silently double-counting.
    const { company, duplicates } = err.data;
    $('#importDupes').innerHTML = `<strong>“${esc(company)}” looks like a deal that's already in the pipeline:</strong>
      ${duplicates.slice(0, 4).map((d) => `<div class="m"><span>${esc(d.lead.company)} <span class="conf ${d.confidence}">${d.confidence}</span><br>
        <span class="sub">${esc(statusLabel(d.lead.status))} · owner ${esc(d.lead.owner_name || 'none')} · ${esc(d.reasons.join(' · '))}</span></span>
        <button type="button" class="btn" data-attach="${d.lead.id}">Add message to this deal</button></div>`).join('')}`;
    $('#importDupes').hidden = false;
    $('#importForce').hidden = false;
    $('#importSubmit').hidden = true;
  }
}
$('#importForm').addEventListener('submit', (e) => { e.preventDefault(); submitImport(); });
$('#importForce').addEventListener('click', () => submitImport({ force: true }));
$('#importDupes').addEventListener('click', (e) => {
  const b = e.target.closest('[data-attach]');
  if (b) submitImport({ attachTo: Number(b.dataset.attach) });
});

initHubspotImport({ getStatuses: () => state.statuses, onDone: (file) => { load(); dupes.load(); actionDone('hubspot_import', file); } });
const dupes = initDuplicates({ getStatuses: () => state.statuses, money, onChange: () => load() });

const roadmapTab = initRoadmap();

// ---------- pages ----------
const PAGES = { deals: 'Deals', duplicates: 'Duplicates', roadmap: 'Roadmap' };
const currentPage = () => (location.hash === '#duplicates' ? 'duplicates' : location.hash === '#roadmap' ? 'roadmap' : 'deals');

function route() {
  const page = currentPage();
  $('#dealsPage').hidden = page !== 'deals';
  $('#dupPage').hidden = page !== 'duplicates';
  $('#rmPage').hidden = page !== 'roadmap';
  document.querySelectorAll('.topnav a').forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  if (page !== 'deals' && !$('#drawer').hidden) { $('#drawer').hidden = true; $('#scrim').hidden = true; state.openId = null; }
  if (page === 'duplicates') dupes.load();
  if (page === 'roadmap') roadmapTab.load();
  const m = location.hash.match(/^#lead-(\d+)/);
  if (m && Number(m[1]) !== state.openId) openLead(Number(m[1]));
  else if (!m && page === 'deals' && state.openId != null) closeDrawer();
}

// The Feedback button on every tab ("Ask"): it knows the tab and the open deal.
initMe();
initFeedbackWidget({
  getPage: () => ({ key: currentPage(), label: PAGES[currentPage()] }),
  getContext: () => {
    if (state.openId != null && !$('#drawer').hidden) {
      const l = state.leads.find((x) => x.id === state.openId);
      return `Deal #${state.openId}${l ? ` ${l.company}` : ''}`;
    }
    if (currentPage() === 'deals') return `${state.view === 'board' ? 'Board' : 'List'} view`;
    return '';
  },
  getMeta: () => roadmapTab.getMeta() ?? { feedbackTypes: [], impacts: [] },
  onSent: () => { if (currentPage() === 'roadmap') roadmapTab.load(); },
});

// After-action pulse (👍/👎 → accuracy → how to improve), with its settings in the "you" dialog.
const pulse = createPulse({ getConfig: () => roadmapTab.getMeta(), getPage: () => currentPage() });
window.addEventListener('action:done', (e) => pulse.ask(e.detail.action, e.detail.context));
window.addEventListener('pulse:toast', (e) => toast(e.detail));
window.addEventListener('pulse:settings', () => document.querySelector('#meBtn').click());
onMeOpen(() => pulse.renderSettings($('#pulseSettings')));
pulse.bindSettings($('#pulseSettings'));

// ---------- boot ----------
async function load() {
  state.leads = await api('/api/leads');
  render();
}
// Keep the Duplicates badge current (the board polls anyway).
const refreshDupes = () => dupes.load().catch(() => {});

(async () => {
  const meta = await api('/api/meta');
  state.statuses = meta.statuses;
  $('#slackState').textContent = meta.slack ? '● Slack connected' : '○ Slack not connected';
  await load();
  window.addEventListener('hashchange', route);
  route();
  refreshDupes();
  if (currentPage() !== 'roadmap') roadmapTab.load();   // feedback types for the Feedback button
  // Live: refresh as soon as the server says something changed; polling stays as a fallback.
  const refreshAll = () => {
    if (dragId != null) return;
    load();
    refreshDupes();
    if (state.openId != null && !$('#drawer').hidden && !$('#drawer').contains(document.activeElement)) openLead(state.openId);
    if (currentPage() === 'roadmap') roadmapTab.load();
  };
  try {
    const events = new EventSource('/api/events');
    events.addEventListener('change', refreshAll);
  } catch {}
  setInterval(() => { if (!document.hidden) refreshAll(); }, 60000);
})();
