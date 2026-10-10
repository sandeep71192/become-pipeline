// Duplicates page: review each suspected pair side by side, then merge (undoable)
// or mark as "not a duplicate" (remembered, so it stops being flagged).
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { getMe } from './me.js';

const post = async (url, body) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: getMe() || null, ...body }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};

const FIELDS = [
  ['company', 'Company'], ['contact_name', 'Contact'], ['contact_role', 'Role'], ['contact_email', 'Email'],
  ['contact_phone', 'Phone'], ['need', 'Need'], ['status', 'Stage'], ['owner_name', 'Owner'], ['value', 'Value'],
  ['next_step', 'Next step'], ['next_follow_up_at', 'Follow-up'], ['source_person', 'Source'],
  ['source_event', 'Source event'], ['hubspot_id', 'HubSpot ID'],
];
const DISMISS_REASONS = ['Different companies', 'Separate deal, same client', 'Returning client, new deal'];

const blank = (v) => v === null || v === undefined || v === '';
const date = (s) => (s ? new Date(s.endsWith('Z') || s.includes('T') ? s : `${s}Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function initDuplicates({ getStatuses, money, onChange }) {
  let data = { pairs: [], merges: [], dismissals: [] };
  const choice = new Map();   // pairKey -> { primary: 'a'|'b', pick: { field: 'a'|'b' } }
  const label = (k) => getStatuses().find((s) => s.key === k)?.label ?? k;

  const show = (field, v) => {
    if (blank(v)) return '<span class="sub">—</span>';
    if (field === 'status') return esc(label(v));
    if (field === 'value') return esc(money(v));
    if (field === 'next_follow_up_at') return esc(date(v));
    return esc(v);
  };

  // Default survivor: the one already linked to HubSpot, else the one with a Slack thread, else the older.
  const defaultPrimary = (p) => {
    const score = (l) => (l.hubspot_id ? 4 : 0) + (l.slack_ts ? 2 : 0);
    if (score(p.a) !== score(p.b)) return score(p.a) > score(p.b) ? 'a' : 'b';
    return p.a.created_at <= p.b.created_at ? 'a' : 'b';
  };

  const keyOf = (p) => `${p.a.id}:${p.b.id}`;
  function stateFor(p) {
    const k = keyOf(p);
    if (!choice.has(k)) {
      const primary = defaultPrimary(p);
      const pick = {};
      for (const [f] of FIELDS) pick[f] = blank(p[primary][f]) && !blank(p[primary === 'a' ? 'b' : 'a'][f]) ? (primary === 'a' ? 'b' : 'a') : primary;
      choice.set(k, { primary, pick });
    }
    return choice.get(k);
  }

  function pairHTML(p, i) {
    const st = stateFor(p);
    const rows = FIELDS.map(([f, name]) => {
      const av = p.a[f], bv = p.b[f];
      if (blank(av) && blank(bv)) return '';
      const same = String(av ?? '') === String(bv ?? '');
      const radio = (side) => same ? show(f, p[side][f])
        : `<label><input type="radio" name="f-${i}-${f}" data-pair="${i}" data-field="${f}" value="${side}" ${st.pick[f] === side ? 'checked' : ''} ${blank(p[side][f]) || f === 'hubspot_id' ? 'disabled' : ''}> <span>${show(f, p[side][f])}</span></label>`;
      return `<tr class="${same ? 'same' : ''}"><td>${name}</td>
        <td class="${!same && st.pick[f] === 'a' ? 'win' : ''}">${radio('a')}</td>
        <td class="${!same && st.pick[f] === 'b' ? 'win' : ''}">${radio('b')}</td></tr>`;
    }).join('');
    const src = (l) => [l.slack_permalink && `<a class="link" href="${esc(l.slack_permalink)}" target="_blank" rel="noopener">Slack</a>`,
      l.hubspot_id && 'HubSpot', `#${l.id}`, `added ${date(l.created_at)}`].filter(Boolean).join(' · ');
    const head = (side) => `<th><label><input type="radio" name="keep-${i}" data-pair="${i}" data-keep="${side}" ${st.primary === side ? 'checked' : ''}> Keep <a class="link" href="#lead-${p[side].id}">${esc(p[side].company)}</a></label><div class="sub">${src(p[side])}</div></th>`;

    return `<article class="pair" data-i="${i}">
      <div class="pair-head">
        <span class="conf ${p.confidence}">${p.confidence}</span>
        <h3>${esc(p.a.company)} ↔ ${esc(p.b.company)}</h3>
        ${p.ownerConflict ? `<span class="flag">Owner conflict: ${esc(p.a.owner_name)} vs ${esc(p.b.owner_name)}</span>` : ''}
        ${p.repeatBusiness ? `<span class="flag info">One is closed: may be a returning client</span>` : ''}
      </div>
      <div class="reasons">${p.reasons.map(esc).join(' · ')}</div>
      <table class="cmp"><thead><tr><th></th>${head('a')}${head('b')}</tr></thead><tbody>${rows}</tbody></table>
      <p class="sub small">Pick the deal to keep and which value wins for each differing field (highlighted). Blank fields are filled from the other deal. Activity from both is combined, and the merge can be undone.</p>
      <div class="pair-actions">
        <select data-reason="${i}" aria-label="Reason">${DISMISS_REASONS.map((r) => `<option>${r}</option>`).join('')}</select>
        <button class="btn" data-dismiss="${i}">Not a duplicate</button>
        <button class="btn primary" data-merge="${i}">Merge into “${esc(p[st.primary].company)}”</button>
      </div>
    </article>`;
  }

  function render() {
    const { pairs } = data;
    const conflicts = pairs.filter((p) => p.ownerConflict).length;
    $('#dupSummary').textContent = pairs.length
      ? `${pairs.length} suspected duplicate pair${pairs.length === 1 ? '' : 's'}${conflicts ? ` · ${conflicts} with an owner conflict` : ''}. Strongest first.`
      : 'No suspected duplicates. New leads from Slack, pasted messages and HubSpot imports are checked as they come in.';
    $('#dupList').innerHTML = pairs.map(pairHTML).join('');
    const badge = $('#dupBadge');
    badge.textContent = pairs.length;
    badge.hidden = !pairs.length;

    $('#mergeHistory div').innerHTML = data.merges.length ? data.merges.map((m) => `<div class="row">
      <span>“${esc(m.secondary_company)}” → “${esc(m.primary_company)}” <span class="sub">· ${date(m.merged_at)}${m.merged_by ? ` · ${esc(m.merged_by)}` : ''}${m.undone_at ? ' · undone' : ''}</span></span>
      ${m.undone_at ? '' : `<button class="btn" data-undo="${m.id}">Undo</button>`}</div>`).join('') : '<p class="sub">No merges yet.</p>';
    $('#dismissHistory div').innerHTML = data.dismissals.length ? data.dismissals.map((d) => `<div class="row">
      <span>“${esc(d.a_company)}” / “${esc(d.b_company)}” <span class="sub">· ${esc(d.reason || '')} · ${date(d.decided_at)}</span></span>
      <button class="btn" data-undismiss="${d.a_id}:${d.b_id}">Flag again</button></div>`).join('') : '<p class="sub">None.</p>';
  }

  async function load() {
    data = await fetch('/api/duplicates').then((r) => r.json());
    render();
  }

  $('#dupPage').addEventListener('change', (e) => {
    const t = e.target;
    const p = data.pairs[Number(t.dataset.pair)];
    if (!p) return;
    const st = stateFor(p);
    if (t.dataset.keep) {
      // Switching the survivor: the survivor's values win by default, blanks filled from the other.
      const other = t.dataset.keep === 'a' ? 'b' : 'a';
      st.primary = t.dataset.keep;
      for (const [f] of FIELDS) st.pick[f] = blank(p[st.primary][f]) && !blank(p[other][f]) ? other : st.primary;
    } else if (t.dataset.field) {
      st.pick[t.dataset.field] = t.value;
    }
    render();
  });

  $('#dupPage').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.merge) {
        const p = data.pairs[Number(b.dataset.merge)];
        const st = stateFor(p);
        const secondary = st.primary === 'a' ? 'b' : 'a';
        const choose = Object.fromEntries(Object.entries(st.pick).filter(([, side]) => side === secondary).map(([f]) => [f, 'secondary']));
        b.disabled = true;
        await post('/api/duplicates/merge', { primaryId: p[st.primary].id, secondaryId: p[secondary].id, choose });
      } else if (b.dataset.dismiss) {
        const p = data.pairs[Number(b.dataset.dismiss)];
        const reason = $(`select[data-reason="${b.dataset.dismiss}"]`).value;
        await post('/api/duplicates/dismiss', { aId: p.a.id, bId: p.b.id, reason });
      } else if (b.dataset.undo) {
        if (!confirm('Undo this merge? The merged deal comes back as a separate card, and fields the merge changed are restored unless edited since.')) return;
        const r = await post(`/api/merges/${b.dataset.undo}/undo`);
        if (r.kept?.length) alert(`Undone. These fields were edited after the merge, so their current values were kept: ${r.kept.join(', ')}.`);
      } else if (b.dataset.undismiss) {
        const [aId, bId] = b.dataset.undismiss.split(':');
        await post('/api/duplicates/undismiss', { aId, bId });
      } else return;
      const done = { merge: 'dup_merge', dismiss: 'dup_dismiss', undo: 'dup_undo' };
      const kind = Object.keys(done).find((k) => b.dataset[k]);
      if (kind) window.dispatchEvent(new CustomEvent('action:done', { detail: { action: done[kind], context: 'Duplicates tab' } }));
      choice.clear();
      await load();
      onChange();
    } catch (err) {
      alert(err.message);
      b.disabled = false;
    }
  });

  return { load };
}
