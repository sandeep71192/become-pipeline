// The Feedback button on every tab: the "Ask" step of the loop.
// It records which tab (and which deal, if one is open) the feedback came from.
import { ensureMe } from './me.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function initFeedbackWidget({ getPage, getContext, getMeta, onSent }) {
  const dlg = $('#fbDlg');

  $('#fbBtn').addEventListener('click', async () => {
    const me = await ensureMe();
    if (!me) return;
    const { feedbackTypes, impacts } = getMeta();
    const page = getPage();
    $('#fbWhere').textContent = [`${page.label} tab`, getContext()].filter(Boolean).join(' · ');
    $('#fbTypes').innerHTML = feedbackTypes.map((t, i) =>
      `<label class="pill" title="${esc(t.hint)}"><input type="radio" name="fbType" value="${t.key}" ${i === 0 ? 'checked' : ''}><span>${esc(t.label)}</span></label>`).join('');
    $('#fbImpacts').innerHTML = impacts.map((t, i) =>
      `<label class="pill"><input type="radio" name="fbImpact" value="${t.key}" ${i === 1 ? 'checked' : ''}><span>${esc(t.label)}</span></label>`).join('');
    $('#fbTypeHint').textContent = feedbackTypes[0].hint;
    $('#fbText').value = '';
    $('#fbErr').hidden = true;
    dlg.showModal();
    $('#fbText').focus();
  });

  $('#fbTypes').addEventListener('change', (e) => {
    $('#fbTypeHint').textContent = getMeta().feedbackTypes.find((t) => t.key === e.target.value)?.hint ?? '';
  });
  $('#fbCancel').addEventListener('click', () => dlg.close());

  $('#fbForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      author: await ensureMe(),
      page: getPage().key,
      context: getContext(),
      type: dlg.querySelector('input[name=fbType]:checked')?.value,
      impact: dlg.querySelector('input[name=fbImpact]:checked')?.value,
      text: $('#fbText').value,
    };
    const res = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { $('#fbErr').textContent = data.error; $('#fbErr').hidden = false; return; }
    dlg.close();
    toast('Thanks! It\'s in Ask on the Roadmap tab. Friday\'s Decide session will pick it up.');
    onSent?.();
  });
}

export function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}
