// Roadmap tab: Overview (cycle, health, next steps), Roadmap (Now/Next/Later),
// Test this week (shared test script), Feedback loop (Ask → Decide → Launch → Test board).
import { ensureMe, getMe, setTeam } from './me.js';
import { toast } from './feedback-widget.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (s) => new Date(s.length === 10 ? `${s}T00:00:00` : `${s}Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export function initRoadmap() {
  let plan = null;
  let sub = (() => { try { return localStorage.getItem('crm.roadmapTab') || 'overview'; } catch { return 'overview'; } })();
  let fbFilter = { type: '', mine: false, roadmap: '' };

  const typeLabel = (k) => plan.feedbackTypes.find((t) => t.key === k)?.label ?? k;
  const impactLabel = (k) => plan.impacts.find((t) => t.key === k)?.label ?? k;
  const lensLabel = (k) => plan.lenses.find((l) => l.key === k)?.label ?? k;
  const testers = () => {
    const names = new Set(plan.team);
    plan.results.forEach((r) => names.add(r.tester));
    if (getMe()) names.add(getMe());
    return [...names];
  };

  // ------------------------------------------------------------ overview
  function overview() {
    const h = plan.health;
    const byStage = h.feedbackByStage;
    const tile = (value, label, target, bad) => `<div class="tile ${bad ? 'bad' : ''}"><b>${value ?? '—'}</b><span>${label}</span><small>${target}</small></div>`;
    const done = new Set(plan.results.map((r) => `${r.tester}:${r.scenario_id}`));
    const progress = testers().map((t) => {
      const n = plan.scenarios.filter((s) => done.has(`${t}:${s.id}`)).length;
      return `<div class="prog"><span>${esc(t)}</span><div class="bar"><i style="width:${Math.round((n / plan.scenarios.length) * 100)}%"></i></div><small>${n}/${plan.scenarios.length}</small></div>`;
    }).join('');
    return `
      <div class="cycle-banner">
        <div><strong>Cycle ${esc(plan.cycle.key)}</strong> · ${day(plan.cycle.from)} – ${day(plan.cycle.to)}</div>
        <div class="sub">One cycle = one week. Test Mon–Tue, use it for real Tue–Thu, Decide on Friday.</div>
      </div>

      <h2 class="h2">The feedback loop</h2>
      <div class="loop">${plan.loop.map((c, i) => `
        <button class="loop-step" data-goto-stage="${c.key}">
          <span class="loop-n">${i + 1}</span>
          <strong>${esc(c.label)}</strong>
          <span class="loop-count">${byStage[c.key] ?? 0} item${byStage[c.key] === 1 ? '' : 's'}</span>
          <span class="sub">${esc(c.text)}</span>
          <span class="loop-who">${esc(c.who)}</span>
        </button>${i < plan.loop.length - 1 ? '<span class="loop-arrow" aria-hidden="true">→</span>' : ''}`).join('')}
      </div>
      <p class="sub small">Every tab has a <strong>Feedback</strong> button (bottom right). A failed test step files feedback automatically. Items loop back to Ask if the fix doesn't hold up in real use.</p>

      <h2 class="h2">Is it working? <span class="sub">(live from real usage, reviewed each Friday)</span></h2>
      <div class="tiles">
        ${tile(h.openDeals, 'open deals', 'the real pipeline once live')}
        ${tile(h.withOwner == null ? null : `${h.withOwner}%`, 'have an owner', 'target 100%', h.withOwner != null && h.withOwner < 100)}
        ${tile(h.withFollowUp == null ? null : `${h.withFollowUp}%`, 'have a follow-up date', 'target 100%', h.withFollowUp != null && h.withFollowUp < 90)}
        ${tile(h.overdue, 'overdue follow-ups', 'target: trending down', h.overdue > 3)}
        ${tile(h.capturedThisCycle, 'leads captured this week', 'from Slack / paste')}
        ${tile(h.parserFixRate == null ? null : `${h.parserFixRate}%`, 'needed a fix after capture', 'target under 5%', h.parserFixRate > 5)}
        ${tile(h.duplicateQueue, 'duplicates waiting', 'target 0 by Friday', h.duplicateQueue > 0)}
        ${tile(h.falseAlarmRate == null ? null : `${h.falseAlarmRate}%`, 'duplicate false alarms', 'target under 30%', h.falseAlarmRate > 30)}
        ${tile(h.pulseUpRate == null ? null : `${h.pulseUpRate}%`, 'of actions rated 👍', 'from quick checks · target 80%+', h.pulseUpRate != null && h.pulseUpRate < 80)}
      </div>

      <div class="two-col">
        <section>
          <h2 class="h2">Test script progress</h2>
          ${progress || '<p class="sub">Nobody has started yet.</p>'}
          <button class="btn" data-sub="tests">Open this week's test script →</button>
        </section>
        <section>
          <h2 class="h2">Next steps</h2>
          <ol class="steps">${plan.nextSteps.map((n) => `<li><span class="when">${esc(n.when)}</span> ${esc(n.step)}</li>`).join('')}</ol>
        </section>
      </div>`;
  }

  // ------------------------------------------------------------ roadmap
  function roadmap() {
    return `
      <h2 class="h2">Built so far <span class="sub">${plan.built.length} features</span></h2>
      <div class="built">${plan.built.map((b) => `<article class="built-card"><h3>${esc(b.title)}</h3><p>${esc(b.text)}</p></article>`).join('')}</div>
      <h2 class="h2">What's next</h2>
      <p class="sub">What we're building and why. Each item has a success measure so we know when it's done. Feedback accepted in Decide is linked to an item here.</p>
      <div class="horizons">${plan.horizons.map((hz) => `
        <section class="horizon">
          <div class="horizon-head"><strong>${esc(hz.label)}</strong><span class="sub">${esc(hz.when)}</span></div>
          ${plan.roadmap.filter((r) => r.horizon === hz.key).map((r) => `
            <article class="rm-card status-${r.status}">
              <div class="rm-top">
                <select data-rm-status="${r.id}" aria-label="Status of ${esc(r.title)}">
                  ${plan.roadmapStatuses.map((s) => `<option value="${s.key}" ${s.key === r.status ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
                </select>
                <select data-rm-horizon="${r.id}" aria-label="Move ${esc(r.title)}">
                  ${plan.horizons.map((x) => `<option value="${x.key}" ${x.key === r.horizon ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
                </select>
              </div>
              <h3>${esc(r.title)}</h3>
              <p><span class="lbl">Why</span> ${esc(r.why)}</p>
              <p><span class="lbl">What</span> ${esc(r.what)}</p>
              <p class="metric"><span class="lbl">Done when</span> ${esc(r.metric)}</p>
              ${r.feedback_count ? `<button class="link-btn" data-rm-feedback="${r.id}">${r.feedback_count} feedback item${r.feedback_count === 1 ? '' : 's'} →</button>` : ''}
              ${r.updated_by ? `<div class="sub small">Updated by ${esc(r.updated_by)} · ${day(r.updated_at)}</div>` : ''}
            </article>`).join('')}
        </section>`).join('')}
      </div>`;
  }

  // ------------------------------------------------------------ tests
  function tests() {
    const me = getMe();
    const people = testers();
    const res = new Map(plan.results.map((r) => [`${r.tester}:${r.scenario_id}`, r]));
    const icon = { pass: '✓', fail: '✗', skip: '–' };
    return `
      <div class="cycle-banner">
        <div><strong>Test script · ${esc(plan.cycle.key)}</strong>${plan.cycle.key !== plan.currentCycle ? ' <span class="flag">past cycle</span>' : ''}</div>
        <div class="sub">Everyone runs every scenario, ideally on real posts. Mark each one. A ✗ asks what went wrong and files it as feedback.</div>
      </div>
      <div class="lens-legend">${plan.lenses.map((l) => `<span class="lens lens-${l.key}">${esc(l.label)}</span>`).join('')}<span class="sub">Each scenario is tagged with the lens it mainly tests.</span></div>
      ${plan.scenarios.map((s) => {
        const mine = res.get(`${me}:${s.id}`);
        const blocked = s.needsSlack && !plan.slack;
        return `<article class="scenario ${mine ? `r-${mine.result}` : ''}">
          <div class="sc-head">
            <span class="sc-id">${s.id}</span>
            <div class="sc-title"><strong>${esc(s.title)}</strong><div><span class="chip">${esc(s.area)}</span> <span class="lens lens-${s.lens}">${esc(lensLabel(s.lens))}</span>${blocked ? ' <span class="chip">needs Slack connected</span>' : ''}</div></div>
            <div class="sc-results">${people.map((p) => {
              const r = res.get(`${p}:${s.id}`);
              return `<span class="res ${r ? `r-${r.result}` : ''}" title="${esc(p)}: ${r ? r.result + (r.note ? ` · ${r.note}` : '') : 'not run yet'}">${esc(p.slice(0, 1).toUpperCase())}${r ? icon[r.result] : ''}</span>`;
            }).join('')}</div>
          </div>
          <div class="sc-body">
            <ol>${s.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>
            <p class="expect"><span class="lbl">Expect</span> ${esc(s.expect)}</p>
            ${plan.results.filter((r) => r.scenario_id === s.id && r.note).map((r) => `<p class="sub small">${esc(r.tester)} (${r.result}): ${esc(r.note)}</p>`).join('')}
          </div>
          <div class="sc-actions">
            <span class="sub">${me ? `Your result${mine ? `: <strong>${mine.result}</strong>` : ''}` : 'Set your name to record results'}</span>
            <button class="btn" data-test="${s.id}" data-result="pass">✓ Pass</button>
            <button class="btn" data-test="${s.id}" data-result="fail">✗ Fail</button>
            <button class="btn" data-test="${s.id}" data-result="skip">Skip</button>
            ${mine ? `<button class="link-btn" data-test="${s.id}" data-result="clear">clear</button>` : ''}
          </div>
        </article>`;
      }).join('')}`;
  }

  // ------------------------------------------------------------ feedback board
  function feedbackCard(f) {
    const me = getMe();
    const voted = f.voters.includes(me);
    let actions = '';
    if (f.stage === 'ask') actions = `<button class="btn" data-fb="${f.id}" data-act="to-decide">Ready for Decide →</button>`;
    if (f.stage === 'decide') actions = `
      <select data-fb-roadmap="${f.id}" aria-label="Roadmap item"><option value="">Link to roadmap item…</option>
        ${plan.roadmap.map((r) => `<option value="${r.id}" ${r.id === f.roadmap_id ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</select>
      <button class="btn primary" data-fb="${f.id}" data-act="accept">Accept</button>
      <button class="btn" data-fb="${f.id}" data-act="park">Park</button>
      <button class="btn" data-fb="${f.id}" data-act="decline">Decline</button>`;
    if (f.stage === 'launch') actions = `<button class="btn" data-fb="${f.id}" data-act="to-test">Shipped → Test</button>`;
    if (f.stage === 'test') actions = `<span class="sub small">${esc(f.author)} to confirm:</span>
      <button class="btn primary" data-fb="${f.id}" data-act="works">Works now ✓</button>
      <button class="btn" data-fb="${f.id}" data-act="broken">Still not right</button>`;
    return `<article class="fb-card impact-${f.impact}">
      <div class="fb-top"><span class="chip type-${f.type}">${esc(typeLabel(f.type))}</span><span class="chip imp">${esc(impactLabel(f.impact))}</span>
        <button class="vote ${voted ? 'on' : ''}" data-fb="${f.id}" data-act="vote" title="${esc(f.voters.join(', '))}">+${f.voters.length}</button></div>
      <p class="fb-text">${esc(f.text)}</p>
      <div class="sub small">${esc(f.author)} · ${esc(f.context || `${f.page || ''} tab`)} · ${day(f.created_at)}</div>
      ${f.roadmap_title ? `<div class="small">↳ Roadmap: <strong>${esc(f.roadmap_title)}</strong></div>` : ''}
      ${f.decision && f.decision !== 'accepted' ? `<div class="small"><strong>${esc(f.decision)}</strong>: ${esc(f.decision_note)}</div>` : ''}
      <div class="fb-actions">${actions}</div>
      <details class="fb-hist"><summary>History (${f.events.length})</summary>
        ${f.events.map((e) => `<div class="small">${day(e.created_at)} · ${esc(e.actor || '')}: ${esc(e.body)}</div>`).join('')}</details>
    </article>`;
  }

  function pulses() {
    const p = plan.pulses;
    if (!p.total.shown) {
      return `<h2 class="h2">Quick checks after actions</h2>
        <p class="sub">After someone adds a lead, moves a stage, merges a duplicate and so on, a small card asks 👍/👎, then how accurate it was, then how it could be better. Results land here. Nothing yet.</p>`;
    }
    const label = (a) => plan.pulseActions[a]?.label ?? a;
    return `<h2 class="h2">Quick checks after actions <span class="sub">${p.total.answered} answer${p.total.answered === 1 ? '' : 's'} from ${p.total.shown} prompt${p.total.shown === 1 ? '' : 's'} · worst first</span></h2>
      <div class="list pulse-table"><table>
        <thead><tr><th>Action</th><th>👍 rate</th><th>Accuracy</th><th>Answered</th><th>Most flagged</th><th>Latest words</th></tr></thead>
        <tbody>${p.actions.map((a) => `<tr>
          <td class="co">${esc(label(a.action))}</td>
          <td><span class="rate ${a.upRate == null ? '' : a.upRate >= 80 ? 'good' : a.upRate >= 50 ? 'mid' : 'bad'}">${a.upRate == null ? '—' : `${a.upRate}%`}</span> <span class="sub small">${a.up} 👍 · ${a.down} 👎</span></td>
          <td>${a.accuracy ?? '—'}<span class="sub small">/5</span></td>
          <td>${a.responseRate ?? '—'}%<span class="sub small"> of ${a.shown}${a.muted ? ` · ${a.muted} muted` : ''}</span></td>
          <td class="wrap">${a.topIssues.map(([k, n]) => `<span class="chip">${esc(k)} ${n}</span>`).join(' ') || '<span class="sub">—</span>'}</td>
          <td class="wrap">${a.comments.slice(0, 2).map((c) => `<div class="small">${c.thumbs === -1 ? '👎' : '👍'} “${esc(c.comment)}” <span class="sub">· ${esc(c.author || 'Anon')}</span>
            ${c.feedback_id ? '<span class="chip">in Ask</span>' : `<button class="link-btn" data-promote="${c.id}">→ Ask</button>`}</div>`).join('') || '<span class="sub">—</span>'}</td>
        </tr>`).join('')}</tbody></table></div>
      <p class="sub small">👎 with a comment goes to Ask automatically. Use “→ Ask” to promote a good 👍 idea.</p>`;
  }

  function feedback() {
    const me = getMe();
    const items = plan.feedback.filter((f) =>
      (!fbFilter.type || f.type === fbFilter.type) && (!fbFilter.mine || f.author === me || f.voters.includes(me)) &&
      (!fbFilter.roadmap || String(f.roadmap_id) === String(fbFilter.roadmap)));
    const sortKey = (f) => ({ blocks: 0, slows: 1, nice: 2 }[f.impact] * 100 - f.voters.length);
    const col = (key, label, hint) => {
      const list = items.filter((f) => f.stage === key).sort((a, b) => sortKey(a) - sortKey(b));
      return `<section class="fb-col" id="fbcol-${key}"><div class="fb-col-head"><strong>${esc(label)}</strong><span class="col-count">${list.length}</span></div>
        <div class="sub small">${esc(hint)}</div>
        ${(key === 'done' ? list.slice(0, 15) : list).map(feedbackCard).join('') || '<p class="sub small empty-col">Nothing here.</p>'}</section>`;
    };
    return `
      <div class="toolbar">
        <select id="fbType" aria-label="Type"><option value="">All types</option>${plan.feedbackTypes.map((t) => `<option value="${t.key}" ${fbFilter.type === t.key ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
        <select id="fbRoadmap" aria-label="Roadmap item"><option value="">Any roadmap item</option>${plan.roadmap.map((r) => `<option value="${r.id}" ${String(fbFilter.roadmap) === String(r.id) ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</select>
        <label class="check"><input type="checkbox" id="fbMine" ${fbFilter.mine ? 'checked' : ''}> Mine & my +1s</label>
        <span class="sub small">Sorted by impact, then votes. Blockers first.</span>
      </div>
      <div class="fb-board">
        ${plan.loop.map((c) => col(c.key, `${c.label}`, c.who)).join('')}
        ${col('done', 'Done', 'Verified, parked or declined')}
      </div>

      ${pulses()}

      <h2 class="h2">Who gives which feedback</h2>
      <p class="sub">With three of us, each person takes one lens per cycle and rotates weekly, so every angle gets a turn. Use these questions in Friday's Decide session.</p>
      <div class="lenses">${plan.lenses.map((l) => `
        <article class="lens-card"><span class="lens lens-${l.key}">${esc(l.label)}</span>
          <p><strong>${esc(l.focus)}</strong></p>
          <ul>${l.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>
          <p class="sub small"><span class="lbl">Watch the numbers</span> ${esc(l.signals)}</p>
        </article>`).join('')}
      </div>
      <h3 class="h3">Beyond the three of us, once it's live</h3>
      <ul class="voices">${plan.otherVoices.map((v) => `<li><strong>${esc(v.who)}:</strong> ${esc(v.ask)}</li>`).join('')}</ul>
      <h3 class="h3">Good feedback, in one line</h3>
      <p class="sub">"When I <em>did X</em> on <em>which deal</em>, I expected <em>Y</em> but got <em>Z</em>. It <em>blocks / slows</em> me." The Feedback button records the tab and the open deal for you.</p>`;
  }

  // ------------------------------------------------------------ shell
  function render() {
    if (!plan) return;
    document.querySelectorAll('#rmTabs button').forEach((b) => b.classList.toggle('on', b.dataset.sub === sub));
    const open = plan.feedback.filter((f) => f.stage !== 'done').length;
    $('#rmTabs [data-sub=feedback] .count').textContent = open ? ` ${open}` : '';
    $('#rmBody').innerHTML = { overview, roadmap, tests, feedback }[sub]();
  }

  async function load() {
    plan = await call('GET', '/api/plan');
    setTeam(plan.team);
    render();
    return plan;
  }

  const go = (name) => { sub = name; try { localStorage.setItem('crm.roadmapTab', sub); } catch {} render(); window.scrollTo(0, 0); };

  $('#rmTabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-sub]'); if (b) go(b.dataset.sub); });

  $('#rmBody').addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    try {
      if (t.dataset.sub) return go(t.dataset.sub);
      if (t.dataset.gotoStage) { go('feedback'); $(`#fbcol-${t.dataset.gotoStage}`)?.scrollIntoView({ behavior: 'smooth', inline: 'center' }); return; }
      if (t.dataset.rmFeedback) { fbFilter = { type: '', mine: false, roadmap: t.dataset.rmFeedback }; return go('feedback'); }
      if (t.dataset.promote) { await call('POST', `/api/pulses/${t.dataset.promote}/promote`, { actor: getMe() || null }); toast('Added to Ask.'); return load(); }

      if (t.dataset.test) {
        const tester = await ensureMe();
        if (!tester) return;
        let note = null;
        if (t.dataset.result === 'fail') {
          note = prompt('What went wrong? (what you did, what you expected, what happened)');
          if (!note) return;
        } else if (t.dataset.result === 'skip') {
          note = prompt('Why skip? (optional)') || null;
        }
        const r = await call('POST', '/api/tests', { cycle: plan.cycle.key, scenario_id: t.dataset.test, tester, result: t.dataset.result, note });
        if (r?.feedbackId) toast('Logged, and filed as "Broken" feedback in Ask.');
        return load();
      }

      if (t.dataset.fb) {
        const actor = await ensureMe();
        if (!actor) return;
        const id = t.dataset.fb;
        const act = t.dataset.act;
        let patch;
        if (act === 'vote') patch = { vote: true };
        if (act === 'to-decide') patch = { stage: 'decide' };
        if (act === 'to-test') patch = { stage: 'test', note: prompt('One-line release note (what changed)?') || undefined };
        if (act === 'accept') patch = { decision: 'accepted', roadmap_id: Number($(`select[data-fb-roadmap="${id}"]`).value) || null };
        if (act === 'park' || act === 'decline') {
          const why = prompt(act === 'park' ? 'Why park it for now?' : 'Why decline it?');
          if (!why) return;
          patch = { decision: act === 'park' ? 'parked' : 'declined', decision_note: why };
        }
        if (act === 'works') patch = { verify: 'works' };
        if (act === 'broken') {
          const why = prompt('What is still wrong?');
          if (!why) return;
          patch = { verify: 'broken', note: why };
        }
        await call('PATCH', `/api/feedback/${id}`, { ...patch, actor });
        return load();
      }
    } catch (err) {
      alert(err.message);
    }
  });

  $('#rmBody').addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.dataset.rmStatus || t.dataset.rmHorizon) {
        const actor = await ensureMe();
        await call('PATCH', `/api/roadmap/${t.dataset.rmStatus || t.dataset.rmHorizon}`,
          t.dataset.rmStatus ? { status: t.value, actor } : { horizon: t.value, actor });
        return load();
      }
      if (t.id === 'fbType') { fbFilter.type = t.value; render(); }
      if (t.id === 'fbRoadmap') { fbFilter.roadmap = t.value; render(); }
      if (t.id === 'fbMine') { fbFilter.mine = t.checked; render(); }
    } catch (err) {
      alert(err.message);
    }
  });

  return { load, getMeta: () => plan };
}
