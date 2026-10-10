// Deal record page, laid out like a HubSpot record:
//   left   – the deal's properties (editable)
//   middle – note composer + activity timeline (filterable)
//   right  – linked contact, company and other deals, duplicates, the original post
import { stepper } from './progress.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sqlDate = (s) => new Date(s.includes('T') || s.endsWith('Z') ? s : `${s.replace(' ', 'T')}Z`);
const money = (v) => (v == null ? '' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v));
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const TL_TYPES = {
  note: 'Note', slack_reply: 'Slack reply', status_change: 'Stage change', edit: 'Edit', created: 'Created',
  merge: 'Merge', duplicate_flag: 'Duplicate check', reminder: 'Reminder',
};
const FILTERS = [
  ['all', 'All'], ['note', 'Notes'], ['slack_reply', 'Slack'], ['status_change', 'Stages'], ['other', 'System'],
];

function field(l, k, label, type = 'text') {
  const v = type === 'datetime-local' ? toLocalInput(l[k]) : l[k];
  return `<label class="prop"><span>${label}</span><input data-field="${k}" type="${type}" value="${esc(v)}" placeholder="—"></label>`;
}

function group(title, body) {
  return `<section class="prop-group"><h3>${title}</h3>${body}</section>`;
}

function timeline(l) {
  const days = new Map();
  for (const a of l.activities) {
    const d = sqlDate(a.created_at);
    const key = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (!days.has(key)) days.set(key, []);
    days.get(key).push({ ...a, d });
  }
  if (!days.size) return '<p class="sub">No activity yet.</p>';
  return [...days].map(([day, items]) => `<div class="tl-day"><h4>${esc(day)}</h4><ul class="timeline">${items.map((a) => {
    const kind = ['note', 'slack_reply', 'status_change'].includes(a.type) ? a.type : 'other';
    return `<li class="${a.type}" data-kind="${kind}">
      <div class="tl-meta"><strong>${esc(TL_TYPES[a.type] ?? a.type)}</strong> · ${esc(a.author || 'System')} · ${a.d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="tl-body">${esc(a.body)}</div></li>`;
  }).join('')}</ul></div>`).join('');
}

export function renderRecord(l, { statuses, avatar, statusLabel }) {
  const created = sqlDate(l.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const contact = l.contact_name || l.contact_email || l.contact_phone;
  return `
  <header class="rec-head">
    <button class="close back" type="button">← Deals</button>
    <div class="rec-title">
      <h1>${esc(l.company)}</h1>
      <p class="sub">${[l.need, l.value ? money(l.value) : null, `created ${created}${l.posted_by ? ` by ${esc(l.posted_by)}` : ''}`].filter(Boolean).map(esc).join(' · ')}</p>
    </div>
    <div class="rec-actions">
      <span class="owner">${avatar(l.owner_name)} ${esc(l.owner_name || 'No owner')}</span>
      <label class="stage-pick"><span class="visually-hidden">Stage</span>
        <select data-field="status">${statuses.map((s) => `<option value="${s.key}" ${s.key === l.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
      ${l.slack_permalink ? `<a class="btn" href="${esc(l.slack_permalink)}" target="_blank" rel="noopener">Slack thread ↗</a>` : ''}
    </div>
  </header>

  ${stepper(l, statuses)}

  <div class="rec-grid">
    <aside class="rec-left" aria-label="Deal details">
      ${group('About this deal', `${field(l, 'company', 'Company')}${field(l, 'need', 'Need')}${field(l, 'value', 'Deal value (₹)', 'number')}${field(l, 'owner_name', 'Owner')}`)}
      ${group('Next step', `${field(l, 'next_step', 'Action')}${field(l, 'next_follow_up_at', 'Follow-up on', 'datetime-local')}`)}
      ${group('Contact', `${field(l, 'contact_name', 'Name')}${field(l, 'contact_role', 'Role')}${field(l, 'contact_email', 'Email', 'email')}${field(l, 'contact_phone', 'Phone', 'tel')}`)}
      ${group('Source', `${field(l, 'source_person', 'Referred by')}${field(l, 'source_event', 'Event / channel')}`)}
      <div class="saved" id="saved" role="status"></div>
    </aside>

    <section class="rec-main" aria-label="Activity">
      <form class="composer note-form" id="noteForm">
        <textarea placeholder="Log a note: call outcome, decision, next move…" required aria-label="Note"></textarea>
        <button class="btn primary">Add note</button>
      </form>
      <div class="tl-filters" role="tablist" aria-label="Filter activity">
        ${FILTERS.map(([k, t], i) => `<button type="button" role="tab" aria-selected="${i === 0}" class="${i === 0 ? 'on' : ''}" data-tl-filter="${k}">${t}</button>`).join('')}
      </div>
      <div class="tl-wrap" data-filter="all">${timeline(l)}</div>
    </section>

    <aside class="rec-right" aria-label="Linked records">
      <section class="assoc">
        <h3>Contact</h3>
        ${contact ? `<div class="assoc-card">
          <div class="assoc-row">${avatar(l.contact_name || '?')}<div><strong>${esc(l.contact_name || 'Unnamed contact')}</strong>${l.contact_role ? `<div class="sub small">${esc(l.contact_role)}</div>` : ''}</div></div>
          ${l.contact_email ? `<div class="assoc-line">✉ <span class="sel">${esc(l.contact_email)}</span></div>` : ''}
          ${l.contact_phone ? `<div class="assoc-line">☎ <span class="sel">${esc(l.contact_phone)}</span></div>` : ''}
        </div>` : '<p class="sub small">No contact yet. Add one under Contact on the left.</p>'}
      </section>
      <section class="assoc">
        <h3>Company</h3>
        <div class="assoc-card"><strong>${esc(l.company)}</strong>
          <div class="sub small">${l.related.length ? `${l.related.length + 1} deals with this company` : 'Only deal with this company'}</div>
        </div>
      </section>
      ${l.related.length ? `<section class="assoc"><h3>Other deals here</h3>${l.related.map((r) => `
        <a class="assoc-card link-card" href="#lead-${r.id}"><strong>${esc(r.need || r.company)}</strong>
          <div class="sub small">${esc(statusLabel(r.status))}${r.value ? ` · ${money(r.value)}` : ''}${r.owner_name ? ` · ${esc(r.owner_name)}` : ''}</div></a>`).join('')}</section>` : ''}
      ${l.duplicates.length ? `<section class="assoc"><h3>Possible duplicates</h3>${l.duplicates.slice(0, 3).map((d) => `
        <a class="assoc-card link-card dup" href="#lead-${d.lead.id}"><strong>${esc(d.lead.company)}</strong> <span class="conf ${d.confidence}">${d.confidence}</span>
          <div class="sub small">${esc(d.reasons[0])} · owner ${esc(d.lead.owner_name || 'none')}</div></a>`).join('')}
        <a class="link small" href="#duplicates">Compare &amp; merge →</a></section>` : ''}
      ${l.merged.length ? `<section class="assoc"><h3>Merged in</h3><p class="sub small">${l.merged.map((m) => `${esc(m.company)} (#${m.id})`).join(', ')}</p></section>` : ''}
      ${l.raw_message ? `<section class="assoc"><details><summary>Original Slack post</summary><div class="raw">${esc(l.raw_message)}</div></details></section>` : ''}
    </aside>
  </div>`;
}

/** Wire the activity filter chips (call once on the record container). */
export function bindRecord(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tl-filter]');
    if (!b) return;
    root.querySelectorAll('[data-tl-filter]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
    root.querySelector('.tl-wrap').dataset.filter = b.dataset.tlFilter;
  });
}
