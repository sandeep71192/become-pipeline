// Duplicate detection shared by every way a lead gets in: Slack, paste, HubSpot import,
// and the review queue that scans the whole pipeline.
//
// Confidence levels:
//   3 exact    same HubSpot record, or same company name once legal suffixes are removed
//   2 likely   same core name ("Skydo" vs "Skydo Technologies Pvt Ltd"), same company email
//              domain, same contact email, or same phone number
//   1 possible similar name (typos, spacing), one name containing the other, same contact
//              person at a similar-looking company, or the same company under two different
//              HubSpot deals
export const LEVEL = { 3: 'exact', 2: 'likely', 1: 'possible' };

const LEGAL = new Set(['pvt', 'private', 'ltd', 'limited', 'llp', 'llc', 'inc', 'incorporated', 'corp', 'corporation',
  'co', 'company', 'plc', 'gmbh', 'pte', 'the', 'opc']);
const GENERIC = new Set(['technologies', 'technology', 'tech', 'labs', 'lab', 'solutions', 'services', 'india', 'global',
  'group', 'software', 'digital', 'studio', 'studios', 'ventures', 'systems', 'media', 'consulting', 'enterprises',
  'industries', 'international', 'online', 'app', 'apps', 'hq', 'official', 'and']);
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com',
  'live.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'rediffmail.com', 'aol.com', 'zoho.com', 'yandex.com']);

const tokens = (s) =>
  String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
    .trim().split(' ').filter(Boolean);

/** Keys used for matching one lead. Exported for tests. */
export function keys(lead) {
  const full = tokens(lead.company).filter((t) => !LEGAL.has(t));
  const coreTokens = full.filter((t) => !GENERIC.has(t));
  const core = (coreTokens.length ? coreTokens : full).join('');
  const email = String(lead.contact_email ?? '').trim().toLowerCase() || null;
  const domain = email?.split('@')[1] ?? null;
  const digits = String(lead.contact_phone ?? '').replace(/\D/g, '');
  const person = tokens(lead.contact_name).join(' ');
  return {
    descriptors: full.filter((t) => GENERIC.has(t)).join(' '),
    full: full.join(' '),
    core,
    coreTokens: coreTokens.length ? coreTokens : full,
    domain: domain && !FREE_MAIL.has(domain) ? domain : null,
    email,
    phone: digits.length >= 10 ? digits.slice(-10) : null,
    person: person.includes(' ') ? person : null,   // single first names ("Rahul") are too common
    hubspot: lead.hubspot_id ? String(lead.hubspot_id) : null,
  };
}

/** Jaro-Winkler similarity, 0..1. */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false), bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(b.length, i + range + 1); j++) {
      if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; matches++; break; }
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k++]) t++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Compare two leads. Returns null or { level, confidence, score, reasons }. */
export function compare(x, y, kx = keys(x), ky = keys(y)) {
  const reasons = [];
  let level = 0;
  const hit = (l, reason) => { level = Math.max(level, l); reasons.push(reason); };

  if (kx.hubspot && kx.hubspot === ky.hubspot) hit(3, 'Same HubSpot record');
  if (kx.full && kx.full === ky.full) hit(3, 'Same company name');
  else if (kx.core && kx.core === ky.core) {
    // "Skydo" vs "Skydo Technologies" is likely the same; "Pixel Labs" vs "Pixel Studio" only possibly.
    if (kx.descriptors && ky.descriptors) hit(1, `Same main name, different descriptor ("${x.company}" / "${y.company}")`);
    else hit(2, `Same name ignoring suffixes ("${x.company}" / "${y.company}")`);
  }
  if (kx.domain && kx.domain === ky.domain) hit(2, `Same email domain @${kx.domain}`);
  if (kx.email && kx.email === ky.email) hit(2, `Same contact email ${kx.email}`);
  if (kx.phone && kx.phone === ky.phone) hit(2, 'Same phone number');

  const sim = similarity(kx.core, ky.core);
  if (level < 1 && kx.core.length >= 4 && ky.core.length >= 4) {
    if (sim >= 0.92) hit(1, `Similar name (${Math.round(sim * 100)}%)`);
    else {
      const [short, long] = kx.coreTokens.length <= ky.coreTokens.length ? [kx, ky] : [ky, kx];
      if (short.coreTokens.join(' ').length >= 4 && long.coreTokens.join(' ').startsWith(short.coreTokens.join(' ') + ' ')) {
        hit(1, 'One name contains the other');
      }
    }
  }
  if (kx.person && kx.person === ky.person && sim >= 0.75) hit(1, `Same contact person (${x.contact_name})`);

  if (!level) return null;
  // Two different HubSpot deals at the same company can be legitimate (e.g. website + app).
  if (kx.hubspot && ky.hubspot && kx.hubspot !== ky.hubspot) {
    level = 1;
    reasons.push('Different HubSpot deals: may be separate projects');
  }
  return { level, confidence: LEVEL[level], score: level + sim / 10, reasons };
}

/**
 * Blocking index over a set of leads, so each lookup only compares against leads that
 * share at least one cheap key (a name token, name prefix, domain, email, phone, person).
 */
export class Matcher {
  constructor(leads = []) {
    this.byId = new Map();
    this.blocks = new Map();
    leads.forEach((l) => this.add(l));
  }

  static blockKeys(k) {
    const out = [];
    if (k.core) out.push(`p:${k.core.slice(0, 4)}`);
    for (const t of k.coreTokens) if (t.length >= 3) out.push(`t:${t}`);
    if (k.domain) out.push(`d:${k.domain}`);
    if (k.email) out.push(`e:${k.email}`);
    if (k.phone) out.push(`ph:${k.phone}`);
    if (k.person) out.push(`n:${k.person}`);
    if (k.hubspot) out.push(`h:${k.hubspot}`);
    return out;
  }

  add(lead) {
    const k = keys(lead);
    this.byId.set(lead.id, { lead, k });
    for (const b of Matcher.blockKeys(k)) {
      if (!this.blocks.has(b)) this.blocks.set(b, new Set());
      this.blocks.get(b).add(lead.id);
    }
  }

  /** Existing leads that look like `lead`, best first. */
  find(lead, { excludeId = lead.id, dismissed = new Set() } = {}) {
    const k = keys(lead);
    const ids = new Set();
    for (const b of Matcher.blockKeys(k)) for (const id of this.blocks.get(b) ?? []) ids.add(id);
    const out = [];
    for (const id of ids) {
      if (id === excludeId || dismissed.has(pairKey(id, excludeId))) continue;
      const other = this.byId.get(id);
      const m = compare(lead, other.lead, k, other.k);
      if (m) out.push({ lead: other.lead, ...m });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** Every duplicate pair in the index. */
  pairs(dismissed = new Set()) {
    const out = [];
    for (const { lead } of this.byId.values()) {
      for (const m of this.find(lead, { dismissed })) {
        if (m.lead.id > lead.id) out.push({ a: lead, b: m.lead, level: m.level, confidence: m.confidence, score: m.score, reasons: m.reasons });
      }
    }
    return out.sort((p, q) => q.score - p.score);
  }
}

export const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
