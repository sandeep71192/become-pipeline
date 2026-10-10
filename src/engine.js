// Rule-based extraction for free-form #sales posts (no API needed):
//   findOrganisation  - the client organisation named in the text
//   classifyNeed      - a short service label ("Website revamp") from a long requirement
//   firstSentence     - a short next-step summary
//   defaultFollowUp   - two working days after posting when no date is given

const ORG_WORDS = /\b(academy|pvt|private|ltd|limited|llp|inc|labs?|school|college|university|foundation|trust|bank|hospital|clinic|studios?|foods?|technologies|tech|solutions|ventures|group|industries|consulting|media|motors|pharma|capital|finance|fintech|health|realty|homes|hotels?|resorts?|cafe|restaurant|brewery|institute|society|association|council|museum|gallery|club|store|stores|retail|systems|networks|digital|agency|partners|enterprises|co|company|corp|corporation)\b/i;
// Capitalised words that start sentences or are common in posts but aren't names.
const STOP = new Set(('The A An We Our My Their They He She It This That These Those In On At For From To Of And Or But If As By With ' +
  'Next Step Source Context Requirement Requirements Need Value Currently Post Also Then After Before Since Because Primary ' +
  'Madam Sir Mr Mrs Ms Dr AI LLM UI UX US UK India Monday Tuesday Wednesday Thursday Friday Saturday Sunday ' +
  'January February March April May June July August September October November December New Lead').split(' '));

/** Most likely client organisation in `text`, ignoring names in `exclude` (contact, referrer). */
export function findOrganisation(text, exclude = []) {
  // "Akhilesh City Vehicle Private (ACVPL) Limited": a name with its acronym is the strongest signal.
  const acr = text.match(/((?:[A-Z][\w&.-]*\s+){1,5})\(([A-Z]{2,8})\)(\s+(?:Private\s+)?(?:Limited|Ltd|Pvt|LLP|Inc)\b)?/);
  if (acr) return `${acr[1].trim()}${acr[3] ?? ''} (${acr[2]})`.replace(/\s+/g, ' ');
  const skip = exclude.filter(Boolean).map((s) => s.toLowerCase());
  const counts = new Map();
  // Runs of 2-5 capitalised words, allowing "of", "&", "and" inside ("Bank of Baroda", "Ernst & Young").
  const re = /\b([A-Z][A-Za-z0-9.'&-]+(?:\s+(?:of|&|and|the|for)?\s*[A-Z][A-Za-z0-9.'&-]+){1,4})\b/g;
  for (const [, raw] of text.matchAll(re)) {
    let words = raw.split(/\s+/);
    while (words.length && STOP.has(words[0])) words = words.slice(1);
    while (words.length && /^(of|&|and|the|for)$/i.test(words.at(-1))) words = words.slice(0, -1);
    if (words.length < 2) continue;
    const name = words.join(' ');
    const low = name.toLowerCase();
    if (skip.some((s) => s && (low.includes(s) || s.includes(low)))) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best = null, bestScore = 0;
  for (const [name, n] of counts) {
    const score = n + (ORG_WORDS.test(name) ? 3 : 0) + name.split(' ').length * 0.1;
    if (score > bestScore) { best = name; bestScore = score; }
  }
  // A single mention of a two-word phrase without an organisation word is usually a person's name.
  return bestScore >= 2 ? best : null;
}

// Service catalogue: first match wins, so specific entries come before general ones.
const SERVICES = [
  [/\bdesign system\b/i, 'Design system'],
  [/\blanding page\b/i, 'Landing page'],
  [/\b(shopify|woocommerce|e-?commerce|online store|d2c (site|store|website))\b/i, 'E-commerce site'],
  [/\b(mobile )?app\b.*\b(redesign|revamp|refresh)\b|\b(redesign|revamp|refresh)\b.*\b(mobile )?app\b/i, 'App redesign'],
  [/\b(mobile app|ios app|android app|app development)\b/i, 'Mobile app'],
  [/\bweb ?site\b.*\b(revamp|redesign|refresh|rebuild|overhaul)\w*|\b(revamp|redesign|refresh|rebuild|overhaul)\w*\b.*\bweb ?site\b/i, 'Website revamp'],
  [/\b(rebrand\w*|brand identity|branding|brand name|brand guidelines|logo)\b/i, 'Brand identity'],
  [/\b(positioning|gtm|go-to-market|messaging|one[- ]liner)\b/i, 'Positioning & GTM'],
  [/\b(b2c|b2b|digital|performance|marketing)\s+campaigns?\b|\bcampaigns?\b|\bdigital marketing\b|\bseo\b|\bads\b/i, 'Marketing campaigns'],
  [/\bweb ?site\b/i, 'Website'],
  [/\b(dashboard|admin panel|internal tool)\b/i, 'Dashboard'],
  [/\b(ui\/ux|ux|ui design|product design)\b/i, 'UI/UX design'],
  [/\bpackaging\b/i, 'Packaging design'],
  [/\b(pitch deck|deck|presentation|collaterals?)\b/i, 'Pitch deck & collateral'],
  [/\b(social media|instagram|content)\b/i, 'Social media'],
  [/\b(video|motion|animation)\b/i, 'Video / motion'],
  [/\bstrategy\b/i, 'Strategy'],
];

/** Short label for what the client wants, or null when nothing in the catalogue matches. */
export function classifyNeed(text) {
  if (!text) return null;
  return SERVICES.find(([re]) => re.test(text))?.[1] ?? null;
}

/** First sentence, capped, for a scannable next-step line. */
export function firstSentence(text, max = 110) {
  if (!text) return null;
  const s = text.replace(/^as (the|a) next step,?\s*/i, '').split(/(?<=[.!?])\s+/)[0].trim();
  const out = s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Two working days after posting, 10:00, so every deal has a date to chase. */
export function defaultFollowUp(postedAt) {
  const d = new Date(postedAt);
  d.setHours(10, 0, 0, 0);
  let added = 0;
  while (added < 2) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}
