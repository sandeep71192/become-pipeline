// After-action pulse: a small card that slides in after an action and asks, one level at a time:
//   1. 👍 / 👎  "Did that work?"
//   2. How accurate was it? (+ "what was off" chips when it wasn't great)
//   3. How could it be better? (optional words)
// Every level is saved as soon as it's answered, so stopping early still counts.
//
// Anti-fatigue rules (all per browser, in localStorage):
//   - one card at a time, never over an open dialog, never twice within a short gap
//   - per-action cooldown and sampling that thin out once an action has been asked a few times
//   - a daily cap; ignored cards back that action off; mute an action or pause for today
//   - three modes: Early stage (default, asks often), Balanced, Off
import { getMe } from './me.js';

const KEY = 'crm.pulse';
const MODES = {
  early:    { label: 'Early stage: ask after most actions', gapMs: 20e3, cooldownMs: 3 * 60e3, dailyCap: 25, alwaysFirst: 5, sampleEvery: 2 },
  balanced: { label: 'Balanced: now and then', gapMs: 3 * 60e3, cooldownMs: 60 * 60e3, dailyCap: 6, alwaysFirst: 2, sampleEvery: 5 },
  off:      { label: 'Off: only the Feedback button' },
};
const AUTO_HIDE_MS = 12e3;        // untouched card at level 1
const ABANDON_MS = 45e3;          // started answering, then walked away

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);

function load() {
  let s;
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { s = {}; }
  s.mode ??= 'early';
  s.muted ??= {};
  s.actions ??= {};
  if (s.day !== today()) { s.day = today(); s.shownToday = 0; }
  return s;
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

const api = async (method, url, body) => {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return res.ok ? res.json() : null;
};

export function createPulse({ getConfig, getPage }) {
  const card = document.querySelector('#pulse');
  let current = null;           // { id, action, cfg, thumbs, accuracy, issues, step }
  let hideTimer = null;

  function shouldAsk(action) {
    const s = load();
    const m = MODES[s.mode];
    if (!m || s.mode === 'off' || s.muted[action]) return false;
    if (s.pausedUntil && Date.now() < s.pausedUntil) return false;
    if (current) return false;
    if (s.lastShownAt && Date.now() - s.lastShownAt < m.gapMs) return false;
    if ((s.shownToday ?? 0) >= m.dailyCap) return false;
    const a = s.actions[action] ?? { shown: 0, ignoredStreak: 0 };
    if (a.lastShownAt && Date.now() - a.lastShownAt < m.cooldownMs) return false;
    let every = a.shown < m.alwaysFirst ? 1 : m.sampleEvery;
    if (a.ignoredStreak >= 3) every *= 3;      // they keep ignoring it: back right off
    return Math.random() < 1 / every;
  }

  function note(action, patch) {
    const s = load();
    s.actions[action] = { shown: 0, ignoredStreak: 0, ...(s.actions[action] ?? {}), ...patch };
    save(s);
    return s;
  }

  /** Call after an action completes. Waits for any open dialog to close first. */
  function ask(action, context = '') {
    const cfg = getConfig()?.pulseActions?.[action];
    if (!cfg || !shouldAsk(action)) return;
    let tries = 0;
    const tryShow = () => {
      if (document.querySelector('dialog[open]') && tries++ < 60) return setTimeout(tryShow, 700);
      if (!document.querySelector('dialog[open]')) show(action, cfg, context);
    };
    setTimeout(tryShow, 600);   // let the UI settle so the card doesn't fight the change itself
  }

  async function show(action, cfg, context) {
    if (current) return;
    const s = load();
    s.lastShownAt = Date.now();
    s.shownToday = (s.shownToday ?? 0) + 1;
    save(s);
    const a = note(action, { shown: (s.actions[action]?.shown ?? 0) + 1, lastShownAt: Date.now() });
    const created = await api('POST', '/api/pulses', { action, page: getPage(), context, author: getMe() || null });
    current = { id: created?.id, action, cfg, context, thumbs: null, accuracy: null, issues: [], step: 1, repeat: a.actions[action].shown >= 3 };
    render();
    card.hidden = false;
    void card.offsetWidth;          // commit the hidden state so the slide-in transition runs
    card.classList.add('in');
    armAutoHide();
  }

  function armAutoHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => close('ignored'), current?.thumbs === null ? AUTO_HIDE_MS : ABANDON_MS);
  }

  const patch = (body) => current?.id && api('PATCH', `/api/pulses/${current.id}`, body);

  function close(status = 'dismissed') {
    if (!current) return;
    clearTimeout(hideTimer);
    const { action, thumbs } = current;
    if (thumbs === null) {
      patch({ status });
      const prev = load().actions[action]?.ignoredStreak ?? 0;
      note(action, { ignoredStreak: status === 'ignored' ? prev + 1 : prev });
    } else {
      note(action, { ignoredStreak: 0 });
    }
    card.classList.remove('in');
    setTimeout(() => { card.hidden = true; card.innerHTML = ''; }, 250);
    current = null;
  }

  const thumbSvg = (down) => `<svg viewBox="0 0 20 20" aria-hidden="true" ${down ? 'style="transform:rotate(180deg)"' : ''}><path fill="currentColor" d="M6 8.5V17H3.8A1.8 1.8 0 0 1 2 15.2v-4.9c0-1 .8-1.8 1.8-1.8zm1.5-.2 3-5.4c.3-.6 1-.9 1.7-.7 1 .3 1.5 1.3 1.3 2.3L13 7.5h3.3c1.2 0 2.1 1.1 1.8 2.3l-1.4 5.6c-.2.9-1 1.6-2 1.6H7.5z"/></svg>`;

  function render() {
    const c = current;
    const acc = getConfig().pulseAccuracy;
    const head = `<div class="pulse-head"><span class="pulse-eyebrow">${esc(c.cfg.label)}${c.step <= 3 ? ` · ${c.step}/3` : ''}</span>
      <div class="pulse-tools">
        <button class="pulse-more" aria-label="More options" aria-haspopup="true" data-p="menu">•••</button>
        <button class="pulse-x" aria-label="Close, no feedback" data-p="close">×</button>
      </div></div>
      <div class="pulse-menu" hidden>
        <button data-p="mute">Don't ask about ${esc(c.cfg.label.toLowerCase())} again</button>
        <button data-p="pause">Pause these for today</button>
        <button data-p="settings">Feedback settings…</button>
      </div>`;
    let body = '';
    if (c.step === 1) {
      body = `<p class="pulse-q">${esc(c.cfg.ask)}</p>
        <div class="pulse-thumbs">
          <button class="thumb up" data-p="up" aria-label="Yes, it worked">${thumbSvg(false)}<span>Yes</span></button>
          <button class="thumb down" data-p="down" aria-label="No, something was off">${thumbSvg(true)}<span>Not quite</span></button>
        </div>
        ${c.repeat ? `<button class="pulse-link" data-p="mute">Asked this before? Don't ask about ${esc(c.cfg.label.toLowerCase())} again</button>` : ''}`;
    }
    if (c.step === 2) {
      const showIssues = c.thumbs === -1 || (c.accuracy && c.accuracy <= 3);
      body = `<p class="pulse-q">${esc(c.cfg.accuracy)}</p>
        <div class="pulse-scale" role="radiogroup" aria-label="Accuracy">
          ${acc.map((label, i) => `<button role="radio" aria-checked="${c.accuracy === i + 1}" class="${c.accuracy === i + 1 ? 'on' : ''}" data-p="acc" data-v="${i + 1}" title="${esc(label)}">${i + 1}</button>`).join('')}
        </div>
        <div class="pulse-scale-labels"><span>${esc(acc[0])}</span><span>${esc(acc[4])}</span></div>
        ${showIssues ? `<p class="pulse-sub">What was off? <span>(tap any)</span></p>
          <div class="pulse-chips">${c.cfg.issues.map((i) => `<button class="${c.issues.includes(i) ? 'on' : ''}" aria-pressed="${c.issues.includes(i)}" data-p="issue" data-v="${esc(i)}">${esc(i)}</button>`).join('')}</div>` : ''}
        <div class="pulse-actions"><button class="pulse-skip" data-p="skip">Skip</button><button class="pulse-next" data-p="next" ${c.accuracy ? '' : 'disabled'}>Next</button></div>`;
    }
    if (c.step === 3) {
      body = `<p class="pulse-q">${c.thumbs === -1 ? 'What would have made it right?' : 'How could it be even better?'}</p>
        <textarea class="pulse-text" rows="3" placeholder="${c.thumbs === -1 ? 'e.g. it should have used the tagged person as owner' : 'Optional: one idea is plenty'}"></textarea>
        <p class="pulse-hint">${c.thumbs === -1 ? 'Sent to Ask on the Roadmap tab for Friday\'s review.' : 'Optional.'}</p>
        <div class="pulse-actions"><button class="pulse-skip" data-p="done">No thanks</button><button class="pulse-next" data-p="send">Send</button></div>`;
    }
    if (c.step === 4) {
      body = `<p class="pulse-thanks">✓ Thanks, logged.${c.promoted ? ' Added to Ask.' : ''}</p>`;
    }
    card.innerHTML = head + body;
    card.querySelector('.pulse-text')?.focus();
  }

  function finish(promoted) {
    current.step = 4;
    current.promoted = promoted;
    render();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => close('answered'), 1400);
  }

  card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  card.addEventListener('focusin', () => clearTimeout(hideTimer));
  card.addEventListener('mouseleave', () => { if (current && current.step < 4) armAutoHide(); });
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') close('dismissed'); });

  card.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-p]');
    if (!b || !current) return;
    const c = current;
    switch (b.dataset.p) {
      case 'close': return close('dismissed');
      case 'menu': { const m = card.querySelector('.pulse-menu'); m.hidden = !m.hidden; return; }
      case 'mute': {
        const s = load(); s.muted[c.action] = true; save(s);
        patch({ status: c.thumbs === null ? 'muted' : 'answered' });
        current.thumbs = current.thumbs ?? 0;   // don't record as ignored
        close('muted');
        return window.dispatchEvent(new CustomEvent('pulse:toast', { detail: `Won't ask about ${c.cfg.label.toLowerCase()} again. Undo in Feedback settings.` }));
      }
      case 'pause': {
        const s = load(); const end = new Date(); end.setHours(23, 59, 59); s.pausedUntil = end.getTime(); save(s);
        close('dismissed');
        return window.dispatchEvent(new CustomEvent('pulse:toast', { detail: 'Paused until tomorrow.' }));
      }
      case 'settings': close('dismissed'); return window.dispatchEvent(new CustomEvent('pulse:settings'));
      case 'up':
      case 'down':
        c.thumbs = b.dataset.p === 'up' ? 1 : -1;
        patch({ thumbs: c.thumbs });
        c.step = 2;
        armAutoHide();
        return render();
      case 'acc':
        c.accuracy = Number(b.dataset.v);
        patch({ accuracy: c.accuracy });
        return render();
      case 'issue': {
        const v = b.dataset.v;
        c.issues = c.issues.includes(v) ? c.issues.filter((x) => x !== v) : [...c.issues, v];
        patch({ issues: c.issues });
        return render();
      }
      case 'skip':
      case 'next':
        c.step = 3;
        return render();
      case 'done': return finish(false);
      case 'send': {
        const text = card.querySelector('.pulse-text').value.trim();
        if (!text) return finish(false);
        const r = await patch({ comment: text });
        return finish(Boolean(r?.promoted));
      }
    }
  });

  // Settings live in the "who are you" dialog.
  function renderSettings(el) {
    const s = load();
    const muted = Object.keys(s.muted).filter((k) => s.muted[k]);
    const labels = getConfig()?.pulseActions ?? {};
    el.innerHTML = `<div class="section-title">Quick feedback after actions</div>
      ${Object.entries(MODES).map(([k, m]) => `<label class="radio-row"><input type="radio" name="pulseMode" value="${k}" ${s.mode === k ? 'checked' : ''}> ${esc(m.label)}</label>`).join('')}
      ${s.pausedUntil && Date.now() < s.pausedUntil ? `<p class="sub small">Paused for today. <button type="button" class="link-btn" data-ps="resume">Resume</button></p>` : ''}
      ${muted.length ? `<p class="sub small">Not asking about: ${muted.map((k) => esc(labels[k]?.label ?? k)).join(', ')}. <button type="button" class="link-btn" data-ps="unmute">Ask again</button></p>` : ''}`;
  }
  function bindSettings(el) {
    el.addEventListener('change', (e) => {
      if (e.target.name !== 'pulseMode') return;
      const s = load(); s.mode = e.target.value; save(s);
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ps]');
      if (!b) return;
      const s = load();
      if (b.dataset.ps === 'unmute') s.muted = {};
      if (b.dataset.ps === 'resume') s.pausedUntil = 0;
      save(s);
      renderSettings(el);
    });
  }

  return { ask, renderSettings, bindSettings };
}
