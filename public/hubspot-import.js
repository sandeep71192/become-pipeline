// "Import HubSpot export" dialog: upload -> check column + stage mapping -> import.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND_LABEL = { deals: 'Deals export', contacts: 'Contacts export', companies: 'Companies export', unknown: 'Spreadsheet' };

export function initHubspotImport({ getStatuses, onDone }) {
  const dlg = $('#hsDlg');
  let data = null;       // preview response
  let stageMap = {};
  let decisions = {};     // rowIndex -> 'update:<id>' | 'new' | 'skip'

  let step = 1;
  const show = (n) => {
    step = n;
    $('#hsStep1').hidden = n !== 1;
    $('#hsStep2').hidden = n !== 2;
    $('#hsStep3').hidden = n !== 3;
    $('#hsResult').hidden = n !== 4;
    $('#hsBack').hidden = n === 1;
    $('#hsBack').textContent = n === 3 ? '← Back to columns' : n === 4 ? 'Import another file' : 'Choose another file';
    $('#hsGo').hidden = n !== 2 && n !== 3;
    $('#hsGo').textContent = n === 2 ? 'Next: check for duplicates →' : 'Import';
    $('#hsErr').hidden = true;
  };
  const fail = (msg) => { $('#hsErr').textContent = msg; $('#hsErr').hidden = false; };

  $('#hubspotBtn').addEventListener('click', () => { data = null; $('#hsFile').value = ''; show(1); dlg.showModal(); });
  $('#hsClose').addEventListener('click', () => dlg.close());
  $('#hsBack').addEventListener('click', () => {
    if (step === 3) return show(2);
    $('#hsFile').value = '';
    show(1);
  });

  // ---- step 1: upload
  const drop = $('#hsDrop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]); });
  $('#hsFile').addEventListener('change', (e) => e.target.files[0] && upload(e.target.files[0]));

  async function upload(file) {
    if (!/\.(xlsx|csv)$/i.test(file.name)) return fail('Please choose an .xlsx or .csv file exported from HubSpot.');
    drop.querySelector('strong').textContent = `Reading ${file.name}…`;
    try {
      const res = await fetch(`/api/hubspot/preview?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      data = body;
      stageMap = Object.fromEntries(data.stages.map((s) => [s.value, s.suggested]));
      $('#hsSub').textContent = `${file.name} · ${KIND_LABEL[data.kind]} · ${data.rows.length} rows`;
      renderMapping();
      renderStages();
      renderPreview();
      show(2);
    } catch (err) {
      fail(err.message);
    } finally {
      drop.querySelector('strong').textContent = 'Choose a file';
    }
  }

  // ---- step 2: mapping
  function columnOptions(selected, allowFirstLast) {
    const opts = [`<option value="">— don't import —</option>`];
    if (allowFirstLast && data.headers.some((h) => /first name/i.test(h))) {
      opts.push(`<option value="${data.firstLast}" ${selected === data.firstLast ? 'selected' : ''}>First Name + Last Name</option>`);
    }
    for (const h of data.headers) opts.push(`<option ${h === selected ? 'selected' : ''}>${esc(h)}</option>`);
    return opts.join('');
  }

  function renderMapping() {
    $('#hsMapping').innerHTML = data.targets.map((t) =>
      `<span>${esc(t.label)}</span><select data-target="${t.key}" aria-label="${esc(t.label)}">${columnOptions(data.mapping[t.key], t.key === 'contact_name')}</select>`
    ).join('');
  }

  function renderStages() {
    const statuses = getStatuses();
    if (!data.mapping.status) {
      $('#hsStages').innerHTML = '';
      $('#hsStageHint').textContent = 'No stage column chosen: everything lands in "Deal generated" (or keeps its current stage when updating).';
      return;
    }
    $('#hsStageHint').textContent = `Values in "${data.mapping.status}" and where they land on your board.`;
    $('#hsStages').innerHTML = data.stages.map((s) =>
      `<span title="${esc(s.value)}">${esc(s.value || '(blank)')} <span class="count">· ${s.count}</span></span>
       <select data-stage="${esc(s.value)}">${statuses.map((st) => `<option value="${st.key}" ${st.key === stageMap[s.value] ? 'selected' : ''}>${esc(st.label)}</option>`).join('')}</select>`
    ).join('');
  }

  function cell(row, key) {
    const col = data.mapping[key];
    if (!col) return '';
    if (col === data.firstLast) return [row['First Name'] ?? row['First name'], row['Last Name'] ?? row['Last name']].filter(Boolean).join(' ');
    const v = row[col];
    return v == null ? '' : /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : String(v);
  }

  function renderPreview() {
    const statuses = getStatuses();
    const label = (k) => statuses.find((s) => s.key === k)?.label ?? k;
    const cols = [['company', 'Company'], ['contact_name', 'Contact'], ['need', 'Need'], ['status', 'Stage'], ['owner_name', 'Owner'], ['value', 'Value'], ['next_follow_up_at', 'Follow-up']];
    const rows = data.rows.slice(0, 5).map((r) => `<tr>${cols.map(([k]) => {
      let v = cell(r, k);
      if (k === 'status') v = data.mapping.status ? label(stageMap[String(r[data.mapping.status] ?? '').trim()] ?? 'deal_generated') : 'Deal generated';
      return `<td>${esc(v) || '<span class="sub">—</span>'}</td>`;
    }).join('')}</tr>`).join('');
    $('#hsPreview').innerHTML = `<table><thead><tr>${cols.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  $('#hsMapping').addEventListener('change', async (e) => {
    const key = e.target.dataset.target;
    data.mapping[key] = e.target.value || null;
    if (key === 'status') {
      const res = await fetch('/api/hubspot/stages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: data.rows, column: data.mapping.status }),
      });
      data.stages = await res.json();
      stageMap = Object.fromEntries(data.stages.map((s) => [s.value, s.suggested]));
      renderStages();
    }
    renderPreview();
  });
  $('#hsStages').addEventListener('change', (e) => {
    stageMap[e.target.dataset.stage] = e.target.value;
    renderPreview();
  });

  // ---- step 3: duplicate review
  const payload = () => ({ rows: data.rows, mapping: data.mapping, stageMap, dateOrder: $('#hsDateOrder').value });

  function renderReview(check) {
    const n = check.review.length;
    $('#hsCheckStats').innerHTML = `
      <div class="stat"><b>${check.new - check.review.filter((r) => r.suggested === 'new').length}</b>new deals</div>
      <div class="stat"><b>${check.update - check.review.filter((r) => r.suggested === 'update').length}</b>exact matches to update</div>
      <div class="stat"><b>${n}</b>need your call</div>
      ${check.invalid ? `<div class="stat"><b>${check.invalid}</b>rows without a company</div>` : ''}`;
    $('#hsReview').innerHTML = n ? `
      <div class="section-title">Possible duplicates: choose what happens to each row</div>
      <div class="review-row sub"><span>Row</span><span>In the file</span><span>Already in the CRM</span><span>Action</span></div>
      ${check.review.map((r) => `<div class="review-row">
        <span>${r.row}</span>
        <span><strong>${esc(r.company)}</strong>${r.contact_name ? `<br><span class="sub">${esc(r.contact_name)}</span>` : ''}</span>
        <span><a class="link" href="#lead-${r.target.id}" target="_blank">${esc(r.target.company)}</a> <span class="conf ${r.confidence}">${r.confidence}</span>
          <br><span class="sub">${esc(r.target.status_label)} · owner ${esc(r.target.owner_name || 'none')} · ${esc(r.reasons.join(' · '))}</span></span>
        <select data-row="${r.index}" aria-label="Action for row ${r.row}">
          <option value="update:${r.target.id}" ${r.suggested === 'update' ? 'selected' : ''}>Same client: update “${esc(r.target.company)}”</option>
          <option value="new" ${r.suggested === 'new' ? 'selected' : ''}>Different: create new (stays flagged for review)</option>
          <option value="skip">Skip this row</option>
        </select></div>`).join('')}`
      : `<p class="sub">No fuzzy matches. Exact matches (same HubSpot record or same company name) are updated automatically.</p>`;
    $('#hsInFile').innerHTML = check.inFile.length ? `
      <div class="section-title">Repeated inside this file</div>
      <p class="sub small">These rows look like an earlier row in the same file. They'll be combined into one deal, and later rows only fill empty fields.</p>
      <ul class="dup-list">${check.inFile.slice(0, 50).map((x) => `<li>Row ${x.row} “${esc(x.company)}” = row ${x.sameAsRow} <span class="sub">· ${esc(x.reasons.join(' · '))}</span></li>`).join('')}</ul>` : '';
    decisions = Object.fromEntries(check.review.map((r) => [r.index, r.suggested === 'update' ? `update:${r.target.id}` : 'new']));
  }

  $('#hsReview').addEventListener('change', (e) => {
    if (e.target.dataset.row) decisions[e.target.dataset.row] = e.target.value;
  });

  $('#hsGo').addEventListener('click', async () => {
    if (!data.mapping.company) return fail('Choose which column holds the company name.');
    $('#hsGo').disabled = true;
    try {
      if (step === 2) {
        $('#hsGo').textContent = 'Checking…';
        const res = await fetch('/api/hubspot/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
        const check = await res.json();
        if (!res.ok) throw new Error(check.error);
        renderReview(check);
        show(3);
        return;
      }
      $('#hsGo').textContent = 'Importing…';
      const res = await fetch('/api/hubspot/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), mode: $('#hsMode').value, filename: data.filename, decisions }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error);
      $('#hsResult').innerHTML = `
        <div class="stats">
          <div class="stat"><b>${r.created}</b>new deals</div>
          <div class="stat"><b>${r.updated}</b>updated</div>
          <div class="stat"><b>${r.unchanged + r.skipped}</b>already up to date / skipped</div>
          <div class="stat"><b>${r.errors.length}</b>rows not imported</div>
        </div>
        ${r.flagged ? `<p>⚠ ${r.flagged} new deal${r.flagged === 1 ? '' : 's'} look similar to existing ones and ${r.flagged === 1 ? 'is' : 'are'} waiting under <a class="link" href="#duplicates">Duplicates</a>.</p>` : ''}
        ${r.errors.length ? `<ul class="errlist">${r.errors.slice(0, 200).map((x) => `<li>Row ${x.row}: ${esc(x.reason)}</li>`).join('')}</ul>` : ''}`;
      show(4);
      onDone(data.filename);
    } catch (err) {
      fail(err.message);
      $('#hsGo').textContent = step === 2 ? 'Next: check for duplicates →' : 'Import';
    } finally {
      $('#hsGo').disabled = false;
    }
  });
}
