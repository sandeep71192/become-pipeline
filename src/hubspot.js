// Import clients from a HubSpot export (.xlsx or .csv): Deals, Companies or Contacts.
//
// Flow: readSheet() -> suggestMapping() + suggestStage() for a preview the user
// can adjust in the UI -> importRows() upserts into the leads table.
import ExcelJS from 'exceljs';
import { STATUSES, STATUS_KEYS, DEFAULT_STATUS, statusLabel } from './statuses.js';
import { insertLead, updateLead, addActivity, listLeads, getRawLead, resolveId, dismissedKeys } from './db.js';
import { Matcher } from './dedupe.js';

export const FIRST_LAST = '__first_last__';

// Lead fields a column can be mapped to, with HubSpot header names to auto-match (in priority order).
export const TARGETS = [
  { key: 'hubspot_id',        label: 'HubSpot record ID', headers: ['record id', 'deal id', 'company id', 'hs object id'] },
  { key: 'company',           label: 'Company *',         headers: ['associated company', 'company name', 'company', 'associated company (primary)', 'deal name'] },
  { key: 'contact_name',      label: 'Contact',           headers: ['associated contact', 'contact name', 'full name', 'name'] },
  { key: 'contact_role',      label: 'Contact role',      headers: ['job title', 'title', 'role'] },
  { key: 'contact_email',     label: 'Contact email',     headers: ['email', 'email address', 'contact email'] },
  { key: 'contact_phone',     label: 'Contact phone',     headers: ['phone number', 'mobile phone number', 'phone'] },
  { key: 'need',              label: 'Need',              headers: ['deal name', 'deal description', 'description', 'service', 'deal type'] },
  { key: 'status',            label: 'Stage',             headers: ['deal stage', 'lead status', 'stage', 'lifecycle stage'] },
  { key: 'owner_name',        label: 'Owner',             headers: ['deal owner', 'company owner', 'contact owner', 'hubspot owner', 'owner'] },
  { key: 'value',             label: 'Deal value',        headers: ['amount', 'amount in company currency', 'deal amount', 'value'] },
  { key: 'next_step',         label: 'Next step',         headers: ['next step', 'next steps'] },
  { key: 'next_follow_up_at', label: 'Follow-up date',    headers: ['next activity date', 'next follow up', 'follow up date', 'close date'] },
  { key: 'source_person',     label: 'Source (person)',   headers: ['referred by', 'source person'] },
  { key: 'source_event',      label: 'Source (event / channel)', headers: ['original source', 'original traffic source', 'lead source', 'source', 'original source type'] },
  { key: 'created_at',        label: 'Created date',      headers: ['create date', 'created date', 'createdate'] },
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------- reading

function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);                  // formula
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);                          // hyperlink
    if ('error' in v) return null;
  }
  return typeof v === 'string' ? v.trim() || null : v;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** @returns {Promise<{headers: string[], rows: object[]}>} */
export async function readSheet(buffer, filename = '') {
  let grid;
  if (/\.csv$/i.test(filename)) {
    grid = parseCsv(buffer.toString('utf8').replace(/^﻿/, ''));
  } else {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch {
      throw new Error('Could not read this file. Export from HubSpot as .xlsx or .csv (old .xls files are not supported).');
    }
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
    if (!ws) throw new Error('The spreadsheet is empty.');
    grid = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(r.getCell(c).value));
      grid.push(vals);
    });
  }

  grid = grid.filter((r) => r.some((v) => v != null && String(v).trim() !== ''));
  if (grid.length < 2) throw new Error('No data rows found under the header row.');
  const headers = grid[0].map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`);
  const rows = grid.slice(1).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] === '' ? null : cellValue(r[i]) ?? null]))
  );
  return { headers, rows };
}

// ---------------------------------------------------------------- guessing

export function detectKind(headers) {
  const h = new Set(headers.map(norm));
  if (h.has('deal stage') || h.has('deal name')) return 'deals';
  if (h.has('first name') || h.has('last name') || h.has('email')) return 'contacts';
  if (h.has('company name')) return 'companies';
  return 'unknown';
}

export function suggestMapping(headers) {
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const kind = detectKind(headers);
  const used = new Set();
  const mapping = {};
  for (const t of TARGETS) {
    // In a contacts export the record ID is the contact's, not the company's, so don't key on it.
    if (t.key === 'hubspot_id' && kind === 'contacts') { mapping[t.key] = null; continue; }
    const hit = t.headers.map((n) => byNorm.get(n)).find((h) => h && !used.has(h));
    mapping[t.key] = hit ?? null;
    if (hit) used.add(hit);
  }
  if (!mapping.contact_name && byNorm.has('first name')) mapping.contact_name = FIRST_LAST;
  // A deal export with no associated-company column: Deal Name is the best company guess, so don't reuse it as need.
  if (mapping.company && mapping.company === mapping.need) mapping.need = null;
  return { kind, mapping };
}

// HubSpot's default stages / statuses -> our stages. Custom stages fall through to keyword rules.
const HUBSPOT_STAGES = {
  'appointment scheduled': 'discovery_1',
  'appointmentscheduled': 'discovery_1',
  'qualified to buy': 'discovery_2',
  'qualifiedtobuy': 'discovery_2',
  'presentation scheduled': 'proposal_1',
  'presentationscheduled': 'proposal_1',
  'decision maker bought in': 'follow_up_1',
  'decisionmakerboughtin': 'follow_up_1',
  'contract sent': 'sow_msa',
  'contractsent': 'sow_msa',
  'closed won': 'active_project',
  'closedwon': 'active_project',
  'closed lost': 'closed_lost',
  'closedlost': 'closed_lost',
  // Lead status
  'new': 'deal_generated',
  'open': 'deal_generated',
  'in progress': 'discovery_1',
  'open deal': 'discovery_1',
  'attempted to contact': 'follow_up_1',
  'connected': 'discovery_1',
  'bad timing': 'on_hold',
  'unqualified': 'closed_lost',
  // Lifecycle stage
  'subscriber': 'deal_generated',
  'lead': 'deal_generated',
  'marketing qualified lead': 'deal_generated',
  'sales qualified lead': 'discovery_1',
  'opportunity': 'proposal_1',
  'customer': 'active_project',
  'evangelist': 'completed_project',
};

const KEYWORDS = [
  [/unqualif|lost|dead|reject|declin/, 'closed_lost'],
  [/payment|invoice|dues?\b|collection/, 'payment_follow_up'],
  [/complete|delivered|done|finished/, 'completed_project'],
  [/project.*hold|hold.*project/, 'project_on_hold'],
  [/hold|paused|later|timing/, 'on_hold'],
  [/won|active|live|ongoing|kick ?off/, 'active_project'],
  [/sow|msa|contract|agreement|sign/, 'sow_msa'],
  [/terms|negotiat|final/, 'finalising_terms'],
  [/follow/, 'follow_up_1'],
  [/proposal|quote|presentation|pitch/, 'proposal_1'],
  [/discovery|appointment|meeting|call|demo|qualif|connect/, 'discovery_1'],
];

export function suggestStage(value) {
  const n = norm(value);
  if (!n) return DEFAULT_STATUS;
  const own = STATUSES.find((s) => norm(s.label) === n || norm(s.key) === n);
  if (own) return own.key;
  // "Discovery call 2", "Follow up 3", "Proposal 2" written slightly differently
  const numbered = n.match(/(discovery|proposal|follow ?up)\D*(\d)/);
  if (numbered) {
    const key = { discovery: 'discovery', proposal: 'proposal', followup: 'follow_up', 'follow up': 'follow_up' }[numbered[1]];
    if (STATUS_KEYS.has(`${key}_${numbered[2]}`)) return `${key}_${numbered[2]}`;
  }
  if (HUBSPOT_STAGES[n]) return HUBSPOT_STAGES[n];
  return KEYWORDS.find(([re]) => re.test(n))?.[1] ?? DEFAULT_STATUS;
}

export function stageValues(rows, column) {
  if (!column) return [];
  const counts = new Map();
  for (const r of rows) {
    const v = r[column] == null ? '' : String(r[column]).trim();
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count, suggested: suggestStage(value) }));
}

// ---------------------------------------------------------------- converting

/** Excel Date, ISO string, "2024-05-03 10:22", "03/05/2024" (day-first unless impossible). */
export function toDate(v, dateOrder = 'dmy') {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {
    // Excel serial date that came through as a number (e.g. from CSV)
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000));
    return null;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.length === 10 ? `${s}T00:00:00` : s.replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    let [a, b] = [Number(m[1]), Number(m[2])];
    let dayFirst = dateOrder === 'dmy';
    if (a > 12) dayFirst = true;
    else if (b > 12) dayFirst = false;
    const [day, month] = dayFirst ? [a, b] : [b, a];
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(year, month - 1, day, Number(m[4] ?? 0), Number(m[5] ?? 0));
    return isNaN(d) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) && String(v).match(/\d/) ? n : null;
}

const str = (v) => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s || null;
};

/** One spreadsheet row -> lead fields, using the (user-confirmed) column mapping. */
export function rowToLead(row, mapping, stageMap = {}, dateOrder = 'dmy') {
  const get = (key) => (mapping[key] ? row[mapping[key]] : null);
  const lead = {};
  for (const key of ['hubspot_id', 'company', 'contact_role', 'contact_email', 'contact_phone', 'need',
    'owner_name', 'next_step', 'source_person', 'source_event']) {
    lead[key] = str(get(key));
  }
  lead.contact_name = mapping.contact_name === FIRST_LAST
    ? [row['First Name'] ?? row['First name'], row['Last Name'] ?? row['Last name']].map(str).filter(Boolean).join(' ') || null
    : str(get('contact_name'));
  // HubSpot joins multiple associations with ";" - keep the first.
  for (const k of ['company', 'contact_name', 'contact_email']) if (lead[k]) lead[k] = lead[k].split(';')[0].trim();
  if (lead.hubspot_id) lead.hubspot_id = lead.hubspot_id.replace(/\.0$/, '');

  if (mapping.status) {
    const raw = str(get('status')) ?? '';
    lead.status = STATUS_KEYS.has(stageMap[raw]) ? stageMap[raw] : suggestStage(raw);
  }
  lead.value = toNumber(get('value'));
  lead.next_follow_up_at = toDate(get('next_follow_up_at'), dateOrder)?.toISOString() ?? null;
  const created = toDate(get('created_at'), dateOrder);
  lead.created_at = created ? created.toISOString().replace('T', ' ').slice(0, 19) : null;
  return lead;
}

// ---------------------------------------------------------------- importing

/**
 * Decide what to do with one row, given the leads already in the pipeline.
 *   exact match (same HubSpot record / same name)   -> update it, no questions
 *   likely match (same core name, domain, email...)  -> update it, but show it for review
 *   possible match (similar name, other HubSpot deal) -> create new, flagged for review
 */
function resolveRow(lead, matcher, dismissed) {
  const matches = matcher.find({ ...lead, id: -1 }, { excludeId: -1, dismissed });
  const top = matches.find((m) => m.reasons.includes('Same HubSpot record')) ?? matches[0];
  if (!top) return { action: 'new' };
  if (top.level === 3) return { action: 'update', target: top.lead, match: top };
  return { action: top.level === 2 ? 'update' : 'new', target: top.lead, match: top, review: true };
}

const brief = (l) => l && { id: l.id, company: l.company, owner_name: l.owner_name, status: l.status, status_label: statusLabel(l.status), hubspot_id: l.hubspot_id };

/**
 * Dry run for the import screen: how each row would be handled, and which rows need a human.
 * Also flags rows that duplicate each other inside the file.
 */
export function checkRows(rows, { mapping, stageMap = {}, dateOrder = 'dmy' }) {
  if (!mapping?.company) throw new Error('Choose which column holds the company name.');
  const matcher = new Matcher(listLeads());
  const dismissed = dismissedKeys();
  const fileMatcher = new Matcher();
  const out = { new: 0, update: 0, review: [], inFile: [], invalid: 0 };

  rows.forEach((row, i) => {
    const lead = rowToLead(row, mapping, stageMap, dateOrder);
    if (!lead.company) { out.invalid++; return; }
    const r = resolveRow(lead, matcher, dismissed);
    out[r.action]++;
    if (r.review) {
      out.review.push({ index: i, row: i + 2, company: lead.company, contact_name: lead.contact_name,
        hubspot_id: lead.hubspot_id, suggested: r.action, target: brief(r.target),
        confidence: r.match.confidence, reasons: r.match.reasons });
    }
    const twin = fileMatcher.find({ ...lead, id: -(i + 1) }, { excludeId: -(i + 1) }).find((m) => m.level >= 2);
    if (twin) out.inFile.push({ row: i + 2, company: lead.company, sameAsRow: -twin.lead.id + 1, reasons: twin.reasons });
    fileMatcher.add({ ...lead, id: -(i + 1) });
  });
  return out;
}

/**
 * Upsert rows.
 * mode "update": sheet values overwrite existing ones (blanks in the sheet never erase data).
 * mode "skip":   existing leads are left alone.
 * decisions:     { [rowIndex]: 'update:<leadId>' | 'new' | 'skip' } from the review step;
 *                rows without a decision use resolveRow's default.
 * Rows that repeat a lead already touched in this import only fill blanks (e.g. several
 * contacts from the same company in a Contacts export).
 */
export function importRows(rows, { mapping, stageMap = {}, mode = 'update', dateOrder = 'dmy', decisions = {},
  filename = 'HubSpot export', actor = 'HubSpot import' }) {
  if (!mapping?.company) throw new Error('Choose which column holds the company name.');
  const result = { created: 0, updated: 0, unchanged: 0, skipped: 0, flagged: 0, errors: [] };
  const touched = new Set();
  const matcher = new Matcher(listLeads());
  const dismissed = dismissedKeys();

  rows.forEach((row, i) => {
    const rowNo = i + 2; // +1 header, +1 one-based
    let lead;
    try {
      lead = rowToLead(row, mapping, stageMap, dateOrder);
    } catch (err) {
      result.errors.push({ row: rowNo, reason: err.message });
      return;
    }
    if (!lead.company) {
      result.errors.push({ row: rowNo, reason: 'No company name' });
      return;
    }

    const resolved = resolveRow(lead, matcher, dismissed);
    const decision = decisions[i] ?? (resolved.action === 'update' ? `update:${resolved.target.id}` : 'new');
    if (decision === 'skip') { result.skipped++; return; }

    if (decision === 'new') {
      const created = insertLead({ ...lead, status: lead.status ?? DEFAULT_STATUS, posted_by: actor }, `Imported from ${filename}`);
      matcher.add(created);
      touched.add(created.id);
      result.created++;
      if (resolved.match) result.flagged++;
      return;
    }

    const existing = getRawLead(resolveId(Number(decision.split(':')[1])));
    if (!existing) { result.errors.push({ row: rowNo, reason: 'Chosen lead no longer exists' }); return; }
    if (mode === 'skip' && !touched.has(existing.id)) { result.skipped++; return; }

    const fillOnly = touched.has(existing.id);
    const patch = {};
    for (const [k, v] of Object.entries(lead)) {
      if (k === 'created_at' || v == null || v === '') continue;
      if (k === 'hubspot_id' && existing.hubspot_id) continue;   // never re-point a HubSpot link
      if (k === 'company' && existing.company) continue;         // keep the name the team already uses
      if (fillOnly && existing[k] != null && existing[k] !== '') continue;
      if (String(existing[k] ?? '') !== String(v)) patch[k] = v;
    }
    touched.add(existing.id);
    if (!Object.keys(patch).length) { result.unchanged++; return; }

    const updated = updateLead(existing.id, patch);
    matcher.add(updated);
    if (patch.status) addActivity(existing.id, 'status_change', `${statusLabel(existing.status)} → ${statusLabel(patch.status)} (${filename})`, actor);
    const changed = Object.keys(patch).filter((k) => k !== 'status' && k !== 'hubspot_id');
    const why = resolved.match && resolved.match.level < 3 ? ` (matched: ${resolved.match.reasons[0]})` : '';
    if (changed.length || why) addActivity(existing.id, 'edit', `Updated from ${filename}${changed.length ? `: ${changed.map((k) => k.replaceAll('_', ' ')).join(', ')}` : ''}${why}`, actor);
    result.updated++;
  });
  return result;
}
