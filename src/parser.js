// Rule-based parser for #sales "New Lead" messages, e.g.
//
//   New Lead/ Skydo
//   Looking for a website. Speaking to Diya, Brand manager.
//   Source: Vishal, auto pilot
//   Next Step: Call on Monday
//   <@U0123ABCD>
//
// The LLM layer (extract.js) can refine the free-text fields; this parser alone
// must always produce a usable lead so the app works without an API key.

const HEADER_RE = /^[\s*_~]*(?:new\s*)?lead[\s*_~]*\s*[\/:\-–—|]\s*(.+?)[\s*_~]*$/i;
import { findOrganisation, findPersonName, classifyNeed, firstSentence, defaultFollowUp } from './engine.js';

const MENTION_RE = /<@([A-Z0-9]+)(?:\|([^>]+))?>/g;
const PLAIN_MENTION_RE = /(^|\s)@([A-Za-z][\w.\-]*)/g;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const FOLLOW_UP_HOUR = 10;

const hasHeader = (text = '') => HEADER_RE.test(firstLine(text));

// Posts without a "New Lead/" header still count when they carry at least two of the
// labelled lines the team uses (Source:, Next Step:, Pricing:, Timeline:, Requirement:...).
const LEAD_LABEL_RE = /^[\s*_•-]*(source|next steps?|pricing|budget|value|timeline|requirements?|current requirements?|contact|poc)\b[*_\s]*:?/i;
// A pasted prospect message (Slack quote block, 3+ lines) with our note on top is a lead too.
const quoteLines = (text) => text.split('\n').filter((l) => /^\s*(>|&gt;)/.test(l));
const isForwardedEnquiry = (text) => {
  const q = quoteLines(text);
  return q.length >= 3 && q.join(' ').length >= 150;
};
export const isNewLeadMessage = (text = '') =>
  hasHeader(text) || isForwardedEnquiry(text) ||
  text.split('\n').filter((l) => LEAD_LABEL_RE.test(l.trim())).length >= 2;

function firstLine(text) {
  return text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}

const clean = (s) => s?.replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim().replace(/[.,;]+$/, '') || null;
const titleCase = (s) => s && s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Slack user IDs tagged in the message, in order. */
export function extractMentions(text = '') {
  const ids = [];
  for (const m of text.matchAll(MENTION_RE)) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}

/** Plain "@name" tags (pasted text, not real Slack mentions). */
function extractPlainMentions(text = '') {
  return [...text.matchAll(PLAIN_MENTION_RE)].map((m) => m[2]);
}

/**
 * Turn phrases like "Call on Monday", "tomorrow", "next week", "in 3 days",
 * "5 Oct", "05/10" into a Date, relative to when the message was posted.
 * Weekday names always mean the *next* such day after the post date.
 */
export function parseRelativeDate(phrase, postedAt = new Date()) {
  if (!phrase) return null;
  const p = phrase.toLowerCase();
  const base = new Date(postedAt);
  base.setHours(FOLLOW_UP_HOUR, 0, 0, 0);
  const addDays = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };

  if (/\b(today|tonight|eod)\b/.test(p)) return base;
  if (/\b(tomorrow|tmrw|tmr)\b/.test(p)) return addDays(1);
  if (/\bday after tomorrow\b/.test(p)) return addDays(2);

  let m = p.match(/\bin\s+(\d+)\s+(day|week)s?\b/);
  if (m) return addDays(Number(m[1]) * (m[2] === 'week' ? 7 : 1));

  m = p.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/);
  if (m) {
    const target = WEEKDAYS.findIndex((d) => d.startsWith(m[1]));
    return addDays((target - base.getDay() + 7) % 7 || 7);
  }
  if (/\bnext week\b/.test(p)) return addDays(((1 - base.getDay() + 7) % 7) || 7);
  if (/\bnext month\b/.test(p)) { const d = new Date(base); d.setMonth(d.getMonth() + 1, 1); return d; }

  // "5 Oct", "Oct 5", "5th October"
  m = p.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\b/) || p.match(/\b([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (m) {
    const [day, mon] = /\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    const month = MONTHS.indexOf(mon);
    if (month >= 0) return rollForward(new Date(base.getFullYear(), month, Number(day), FOLLOW_UP_HOUR), base);
  }
  // "22nd", "on the 5th": that day of this month, or next month if it has passed
  m = p.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (m && Number(m[1]) <= 31) {
    const d = new Date(base.getFullYear(), base.getMonth(), Number(m[1]), FOLLOW_UP_HOUR);
    if (d < base) d.setMonth(d.getMonth() + 1);
    return d;
  }
  // "05/10" or "5-10" (day/month, as written in India)
  m = p.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
  if (m) {
    const year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : base.getFullYear();
    const d = new Date(year, Number(m[2]) - 1, Number(m[1]), FOLLOW_UP_HOUR);
    return m[3] ? d : rollForward(d, base);
  }
  return null;
}

function rollForward(date, base) {
  if (date < base) date.setFullYear(date.getFullYear() + 1);
  return date;
}

/** Split "Call on Monday" into { action: "Call", when: "Monday" }. */
function splitNextStep(text) {
  const m = text.match(/^(.*?)\s+(?:on|by|this|next|before|in|tomorrow|today)\b(.*)$/i);
  if (!m) return { action: text, when: text };
  const whenWord = text.slice(m[1].length).trim();
  return { action: clean(m[1]) || text, when: whenWord };
}

/**
 * Parse a "New Lead" message.
 * @param {string} text        raw Slack message text
 * @param {Date}   postedAt    when the message was posted (for relative dates)
 * @returns {object|null}      lead fields, or null if it isn't a New Lead message
 */
// Slack wraps links as <url|label>, emails as <mailto:x|x>; it also leaves invisible
// direction marks around pasted phone numbers. Turn all of that back into plain text.
function unwrapSlack(text) {
  return text
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/<mailto:[^|>]+\|([^>]+)>/g, '$1')
    .replace(/<tel:[^|>]+\|([^>]+)>/g, '$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');   // Slack escapes these
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /^\+?[\d\s().-]{9,}$/;
// "7L", "7 lakh", "1.2 Cr", "₹ 50k" -> rupees
const VALUE_RE = /(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(l|lakh|lakhs|lac|lacs|cr|crore|crores|k)\b/i;
const UNIT = { l: 1e5, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7, k: 1e3 };

export function parseLeadMessage(rawText, postedAt = new Date()) {
  if (!rawText || !isNewLeadMessage(rawText)) return null;
  const withHeader = hasHeader(rawText);
  const headerIsLinkedIn = withHeader && /linkedin\.com\/in\//i.test(firstLine(rawText));
  const text = unwrapSlack(rawText);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const header = withHeader ? firstLine(text).match(HEADER_RE)[1].replace(MENTION_RE, '') : '';
  // The header can be "Company", "Name, phone" (LinkedIn) or "Name, Role, Company".
  const parts = header.split(/\s*,\s*/).map(clean).filter(Boolean);
  const headerPhone = parts.find((p) => PHONE_RE.test(p));
  const named = parts.filter((p) => p !== headerPhone);
  let company = null, headerContact = null, headerRole = null;
  if (withHeader) {
    if (named.length >= 3) [headerContact, headerRole, company] = [named[0], named.slice(1, -1).join(', '), named.at(-1)];
    else if (headerIsLinkedIn || headerPhone) headerContact = named[0] ?? null;
    else company = clean(header);
  }
  const forwarded = !withHeader && isForwardedEnquiry(rawText);
  // Pasted enquiries name sectors ("B2B Fintech") more often than companies: ask rather than guess.
  if (!company && !headerContact && !forwarded) company = findOrganisation(text.replace(MENTION_RE, ''));
  if (!company && !withHeader && !forwarded) company = clean(firstSentence(firstLine(text), 40));

  const lead = {
    company,
    contact_name: null,
    contact_role: null,
    need: null,
    source_person: null,
    source_event: null,
    next_step: null,
    next_follow_up_at: null,
    owner_slack_ids: extractMentions(text),
    owner_plain: extractPlainMentions(text.replace(MENTION_RE, '').replace(EMAIL_RE, ''))[0] ?? null,
    contact_email: text.match(EMAIL_RE)?.[0] ?? null,
    contact_phone: headerPhone ?? null,
    value: null,
    notes: [],
  };
  if (headerContact) { lead.contact_name = headerContact; lead.contact_role = headerRole; }
  if (!lead.company) lead.company = lead.contact_name;   // placeholder until a company is found below
  const money = text.match(VALUE_RE);
  if (money) lead.value = Math.round(Number(money[1]) * UNIT[money[2].toLowerCase()]);

  const bodyLines = withHeader ? lines.slice(1) : lines;
  for (const line of bodyLines) {
    const kv = line.match(/^[*_]*([A-Za-z][A-Za-z \-]{1,20}?)[*_]*\s*:\s*(.+)$/);
    const key = kv?.[1].toLowerCase().replace(/[\s\-]+/g, ' ').trim();
    const value = kv?.[2].replace(MENTION_RE, '').trim();

    if (!kv && PHONE_RE.test(line)) { lead.contact_phone ??= line.replace(/\s+/g, ' '); continue; }
    if (!kv && EMAIL_RE.test(line) && line.length < 80) continue;   // already captured above

    if (key === 'company' || key === 'organisation' || key === 'organization' || key === 'client' || key === 'brand') {
      lead.company = clean(value);
      lead.company_from_key = true;
      continue;
    }
    if (key === 'source' || key === 'lead source' || key === 'referred by') {
      const [person, ...rest] = value.split(/\s*,\s*/);
      if (person.split(/\s+/).length <= 4) {
        lead.source_person = clean(person);
        lead.source_event = titleCase(clean(rest.join(', ')));
      } else {
        lead.source_event = clean(value);   // a sentence, not "Name, event": keep it whole
      }
    } else if (key === 'next step' || key === 'next steps' || key === 'next') {
      const { action, when } = splitNextStep(clean(value) ?? '');
      lead.next_step = clean(value)?.replace(/^./, (c) => c.toUpperCase());
      const due = parseRelativeDate(when, postedAt);
      if (due) lead.next_follow_up_at = due.toISOString();
      if (!lead.next_step) lead.next_step = action;
    } else if (key === 'contact' || key === 'poc' || key === 'speaking to') {
      const [name, ...role] = value.split(/\s*,\s*/);
      lead.contact_name = clean(name);
      lead.contact_role = clean(role.join(', '));
    } else if (['need', 'requirement', 'requirements', 'current requirement', 'current requirements', 'looking for', 'scope'].includes(key)) {
      lead.need = clean(value);
    } else if (key === 'owner') {
      // handled via mentions
    } else {
      const body = line.replace(MENTION_RE, '').trim();
      if (body) lead.notes.push(body);
      applyFreeText(lead, body);
    }
  }
  return enrich(lead, bodyLines.join('\n'), postedAt);
}

// Tidy free-form posts into scannable fields. Long originals are kept in notes.
const ACTION_RE = /\b(send|share|call|meet|talk|chat|connect|schedule|book|follow ?up|reach ?out|get the brief|proposal|demo|sign|discuss)\b/i;

function enrich(lead, body, postedAt) {
  const ownText = body.split('\n').filter((l) => !/^\s*(>|&gt;)/.test(l)).join('\n');
  const quoted = body.split('\n').filter((l) => /^\s*(>|&gt;)/.test(l)).map((l) => l.replace(/^\s*(>|&gt;)\s*/, '').replace(/[_*]/g, '')).join('\n');

  // No "Next Step:" line: use the first sentence of our own text that asks for an action.
  if (!lead.next_step) {
    const sentence = ownText.replace(MENTION_RE, '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).find((x) => ACTION_RE.test(x));
    if (sentence) lead.next_step = clean(sentence)?.replace(/^./, (c) => c.toUpperCase());
  }
  if (!lead.next_follow_up_at) {
    // The date can sit in any action sentence ("…we will schedule a call after 22nd").
    const candidates = [lead.next_step, ...ownText.replace(MENTION_RE, '').split(/(?<=[.!?])\s+|\n+/).filter((x) => ACTION_RE.test(x))];
    for (const c of candidates.filter(Boolean)) {
      const due = parseRelativeDate(c, postedAt);
      if (due) { lead.next_follow_up_at = due.toISOString(); break; }
    }
  }
  // A pasted enquiry: what they want is in their words, not ours.
  if (quoted && !lead.need) lead.need = classifyNeed(quoted);

  if (!lead.company_from_key && lead.contact_name && lead.company === lead.contact_name) {
    const org = findOrganisation(body.replace(MENTION_RE, ''), [lead.contact_name, lead.source_person]);
    if (org) lead.company = org;
  }
  if (lead.need && lead.need.split(/\s+/).length <= 6) {
    lead.need = classifyNeed(lead.need) ?? lead.need;   // "Rebranding" -> "Brand identity"
  } else if (lead.need) {
    lead.notes.push(`Requirement: ${lead.need}`);
    lead.need = classifyNeed(lead.need) ?? classifyNeed(body) ?? firstSentence(lead.need, 60);
  }
  // A "Requirements" heading followed by bullets says more than any other sentence in the post.
  const section = body.match(/requirements?\W*\n((?:\s*[•*-].*\n?)+)/i)?.[1];
  if (section) {
    lead.need = classifyNeed(section) ?? lead.need;
    lead.notes.push(`Requirements: ${section.split('\n').map((l) => l.replace(/^\s*[•*-]\s*/, '').trim()).filter(Boolean).join(', ')}`);
  }
  if (!lead.need) lead.need = classifyNeed(body);
  if (lead.next_step && lead.next_step.length > 110) {
    lead.notes.push(`Next step: ${lead.next_step}`);
    lead.next_step = firstSentence(lead.next_step);
  }
  if (!lead.next_follow_up_at) {
    lead.next_follow_up_at = defaultFollowUp(postedAt).toISOString();
    lead.follow_up_defaulted = true;
  }
  if (!lead.company) {
    lead.company = 'New enquiry (company TBC)';
    lead.company_missing = true;
  }
  delete lead.company_from_key;
  return lead;
}

// Heuristics for the free-text sentence(s). The LLM layer does this better.
function applyFreeText(lead, sentence) {
  if (!lead.need) {
    const m = sentence.match(/\b(?:looking for|needs?|wants?|interested in|requirement(?: is)?)\s+(?:a |an |the )?([^.]+)/i);
    // "wants to focus on…" is a verb phrase, not a requirement.
    if (m && !/^to\b/i.test(m[1].trim())) lead.need = titleCaseFirst(clean(m[1]));
  }
  if (!lead.contact_name) {
    const m = sentence.match(/\b(?:speaking|spoke|talking|talked|connected|in touch)\s+(?:to|with)\s+([^,.(]+?)(?:\s*[,(]\s*([^.)]+))?[.)]?(?:$|\.)/i)
      || sentence.match(/\bPOC(?: is)?\s*[:\-]?\s*([^,.(]+?)(?:\s*[,(]\s*([^.)]+))?[.)]?(?:$|\.)/i);
    if (m) {
      lead.contact_name = clean(m[1]);
      lead.contact_role = titleCaseFirst(clean(m[2]));
    }
  }
}

const titleCaseFirst = (s) => s && s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- screenshots

const ANY_PHONE_RE = /(\+?\d[\d\s().-]{8,}\d)/;

/**
 * A lead from a screenshot (OCR text) plus whatever was typed with it.
 * The typed note wins where it says something; the screenshot fills the gaps.
 */
export function parseScreenshotLead({ note = '', ocr = '', postedAt = new Date() }) {
  const typed = unwrapSlack(note || '');
  let lead = isNewLeadMessage(note) ? parseLeadMessage(note, postedAt) : null;
  if (!lead) {
    lead = {
      company: null, contact_name: null, contact_role: null, need: null, source_person: null, source_event: null,
      next_step: null, next_follow_up_at: null, owner_slack_ids: extractMentions(note), owner_plain: null,
      contact_email: null, contact_phone: null, value: null, notes: [],
    };
    // Our typed words are "own text"; the screenshot is the prospect's words (quoted).
    const quoted = ocr.split('\n').map((l) => `> ${l}`).join('\n');
    lead = enrich(lead, `${typed}\n${quoted}`, postedAt);
  }
  lead.contact_email ??= ocr.match(EMAIL_RE)?.[0] ?? null;
  lead.contact_phone ??= ocr.match(ANY_PHONE_RE)?.[1]?.replace(/\s+/g, ' ') ?? null;
  if (!lead.value) {
    const money = ocr.match(VALUE_RE);
    if (money) lead.value = Math.round(Number(money[1]) * UNIT[money[2].toLowerCase()]);
  }
  lead.contact_name ??= findPersonName(ocr);
  // LinkedIn headline: "Head of Marketing at Lumen Skin Labs" gives role and company.
  const headline = ocr.split('\n').slice(0, 6).map((l) => l.match(/^(.{3,60}?)\s+(?:at|@)\s+([A-Z][^,|•]{1,60})$/)).find(Boolean);
  if (headline) {
    lead.contact_role ??= clean(headline[1]);
    if (lead.company_missing || !lead.company || lead.company.endsWith('(company TBC)')) { lead.company = clean(headline[2]); delete lead.company_missing; }
  }
  // "Can we talk on Thursday?" in their message sets the follow-up if ours didn't.
  if (lead.follow_up_defaulted) {
    for (const sentence of ocr.split(/(?<=[.!?])\s+|\n+/).filter((x) => ACTION_RE.test(x))) {
      const due = parseRelativeDate(sentence, postedAt);
      if (due) {
        lead.next_follow_up_at = due.toISOString();
        delete lead.follow_up_defaulted;
        lead.next_step ??= `Reply to them: ${clean(sentence)}`;
        break;
      }
    }
  }
  if (lead.company_missing || !lead.company || lead.company === lead.contact_name) {
    const org = findOrganisation(ocr, [lead.contact_name]);
    if (org) { lead.company = org; delete lead.company_missing; }
    else if (lead.contact_name && lead.company_missing) lead.company = `${lead.contact_name} (company TBC)`;
  }
  lead.need ??= classifyNeed(ocr);
  lead.from_screenshot = true;
  return lead;
}
