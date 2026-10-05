/**
 * PartnerPulse SAMPLE — text helpers + extractors (isomorphic: Node + browser).
 * SAMPLE / PORTFOLIO DEMO — not a client deliverable.
 */
export const CURRENT_YEAR = 2026;

export function norm(t) {
  return String(t || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}
export function bare(t) {
  return norm(t).replace(/[!?.,~]+$/g, "").replace(/\s+(lah|lor|leh|ah|ya|sia|hor)$/g, "").trim();
}
export function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
export function listJoin(arr) {
  const a = arr.filter(Boolean);
  if (a.length <= 1) return a.join("");
  return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}
/** Deterministic pick so the same transcript always gives the same reply. */
export function pick(arr, seed) {
  let h = 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

const VAGUE = new Set([
  "ok", "okay", "k", "kk", "sure", "maybe", "not sure", "unsure", "dunno", "idk", "depends", "it depends", "hmm", "hmmm", "hm",
  "nil", "na", "n/a", "-", "can", "ya", "yah", "yeah", "see how", "anything", "whatever", "any", "lol", "?", "...",
  "i don't know", "i dont know", "dont know", "don't know", "no idea", "up to you", "you tell me", "anyhow", "not really sure",
  "hi", "hello", "hey", "yo", "test", "sian", "huh", "what", "eh",
]);
export function isVague(t) {
  const b = bare(t);
  if (!b) return true;
  if (VAGUE.has(b)) return true;
  if (b.length <= 2) return true;
  return false;
}

// ---------- intents ----------
export const INTENT = {
  optOut: /\b(stop|unsubscribe|not interested|no thanks|don'?t contact|leave me alone|remove me)\b/,
  human: /\b(human|real person|actual person|live agent|a person|someone real|speak (to|with) (someone|a person|sales|your team|daniel|wei ling)|talk (to|with) (someone|a person|sales|your team|daniel|wei ling)|call me|can someone (call|contact)|get someone|your boss|a real one|get (daniel|wei ling|someone|a person|a human)|speak to (daniel|wei ling))\b/,
  bot: /\b(are you (a |an )?(bot|ai|robot|real|human|machine)|is this (a |an )?(bot|ai|automated|real person)|chatgpt|bot ah|ai ah|you (a )?bot)\b/,
  scam: /\b(scam|spam|how did you get my (number|contact)|legit|is this real)\b/,
  skeptic: /\b(why should i|why you|what makes you different|intern can|heard this before|sounds too good|waste of time|guarantee|prove it|so many agencies|every agency says|another agency|not convinced|doubt)\b/,
  price: /\b(how much|what'?s the (price|cost)|pricing|cost (me|us)|your (rates?|fees?|price)|quote me|expensive|ballpark price)\b/,
  commission: /\b(commission|how (do|will) (you|we|i) (get )?(pay|paid)|payment terms|margins?|rev(enue)? share|how much (do|will|can) (you|we|i) (pay|earn|make))\b/,
  whatIs: /\b(what is this|what's this|who are you|what do you (guys )?do|what is partnerpulse|what's partnerpulse|explain)\b/,
  howLong: /\b(how long (will|does|would) (it|this) take|how fast|turnaround|lead time)\b/,
  integrate: /\b(work with|integrate|integration|connect (to|with)|support) (ghl|gohighlevel|highlevel|hubspot|salesforce|zoho|shopify|google sheets?|sheets)\b/,
};

// ---------- dictionaries ----------
export const INDUSTRIES = [
  { key: "fnb", label: "F&B", rx: /\b(f&b|fnb|f and b|cafe|cafes|café|restaurant|bakery|catering|food|kopitiam|hawker|bubble tea|bar)\b/, core: true,
    ack: "F&B — noted. Reservations and catering enquiries tend to pile up on WhatsApp." },
  { key: "ecommerce", label: "E-commerce", rx: /\b(e-?commerce|online shop|online store|shopify|lazada|shopee|dtc)\b/, core: true,
    ack: "E-commerce, noted. Order and delivery queries are very automatable." },
  { key: "retail", label: "Retail", rx: /\b(retail|shop|boutique|store|outlet)\b/, core: true,
    ack: "Retail, ok. Stock and order-status questions are usually the bulk of chats." },
  { key: "property", label: "Property / real estate", rx: /\b(property|real estate|realty|condo|hdb|propnex|era|huttons|landlord)\b/, core: true,
    ack: "Property — ok. Speed of reply matters a lot for viewings." },
  { key: "renovation", label: "Renovation / interior", rx: /\b(renovation|reno|interior|id firm|carpentry|contractor|aircon|plumbing)\b/, core: true,
    ack: "Renovation, noted. Lots of quote requests that need sorting before a site visit." },
  { key: "education", label: "Education / tuition", rx: /\b(education|tuition|enrichment|school|academy|learning centre|learning center|courses?|training)\b/, core: true,
    ack: "Education, ok. Trial-class bookings are a common fit." },
  { key: "health", label: "Healthcare / clinic", rx: /\b(clinic|medical|dental|healthcare|health care|physio|tcm|aesthetic)\b/, core: true,
    ack: "Healthcare, noted. We'd keep anything clinical out of the bot." },
  { key: "beauty", label: "Beauty / wellness", rx: /\b(beauty|salon|spa|wellness|nail|lash|gym|fitness|yoga|pilates)\b/, core: true,
    ack: "Beauty and wellness, ok. Booking and rescheduling is usually the main load." },
  { key: "logistics", label: "Logistics", rx: /\b(logistics|freight|courier|delivery company|shipping|warehouse|transport|movers?)\b/, core: true,
    ack: "Logistics — noted. Lots of repetitive status queries there." },
  { key: "professional", label: "Professional services", rx: /\b(law|legal|accounting|accountant|audit|corporate secretar|consult(ing|ancy)|agency|hr firm|recruit(ment|ing)?)\b/, core: true,
    ack: "Professional services, ok. Lead screening before a consult is usually the win." },
  { key: "finance", label: "Finance / insurance", rx: /\b(finance|fintech|insurance|wealth|financial advis|mortgage)\b/, core: false,
    ack: "Finance, noted. There are MAS-related limits on what a bot can say, so we keep it to admin." },
  { key: "manufacturing", label: "Manufacturing / B2B", rx: /\b(manufactur|factory|industrial|b2b|wholesale|distribut|supplier|trading)\b/, core: true,
    ack: "B2B, ok. Usually it's quote requests and distributor enquiries." },
  { key: "tech", label: "Tech / SaaS", rx: /\b(saas|software|tech startup|startup|app company)\b/, core: false,
    ack: "Tech, noted." },
  { key: "hospitality", label: "Hospitality / travel", rx: /\b(hotel|hostel|travel|tour|hospitality|events?)\b/, core: true,
    ack: "Hospitality, ok. Enquiries come in at all hours there." },
];
export function detectIndustries(t) {
  const n = norm(t);
  return INDUSTRIES.filter((i) => i.rx.test(n));
}

export const NEEDS = [
  { key: "whatsapp", short: "WhatsApp enquiries", label: "WhatsApp enquiries / chatbot", rx: /\b(whatsapp|wa\b|chat ?bots?\b|bots?\b|auto-?repl\w*|enquir\w*|inquir\w*|customer service|repl(y|ies|ying)\b|chats?\b)/,
    ack: "Ok, WhatsApp enquiries. That's usually where SMEs here lose the most time." },
  { key: "crm", short: "CRM follow-up", label: "CRM / pipeline follow-up", rx: /\b(crm|ghl|gohighlevel|highlevel|pipeline|follow[- ]?ups?|hubspot|salesforce|lead tracking)\b/,
    ack: "Got it — pipeline and follow-ups. Most leaks happen there, not at the top of the funnel." },
  { key: "leads", short: "lead generation", label: "Lead generation / marketing", rx: /\b(more leads|leads|marketing|ads|facebook|google ads|seo|traffic|funnel)\b/,
    ack: "Ok, lead flow. Worth looking at what happens after leads come in too." },
  { key: "website", short: "the website", label: "Website", rx: /\b(website|web site|landing page|webpage)\b/,
    ack: "Noted, website work." },
  { key: "automation", short: "automation", label: "Automation / AI (general)", rx: /\b(automat\w*|ai|workflow|manual work|admin|integrat\w*)\b/,
    ack: "Ok, automation in general — we'll narrow it down." },
];
export const HARD_OOS = /\b(job|vacancy|intern(ship)?|hiring me|looking for work|crypto|forex|mlm|loan|money lending|casino|betting)\b/;
export const SOFT_OOS = /\b(free|for free|student|school project|assignment|fyp|thesis)\b/;

export const SERVICES = [
  { key: "web", label: "Web development", rx: /\b(web(site)?s?|wordpress|shopify|webflow|frontend|front-end|backend|back-end|full-?stack|react|next\.?js|laravel)\b/ },
  { key: "app", label: "App development", rx: /\b(apps?|mobile|ios|android|flutter|react native)\b/ },
  { key: "design", label: "Design / branding", rx: /\b(design|branding|ui|ux|ui\/ux|graphic|logo)\b/ },
  { key: "perf", label: "Performance marketing", rx: /\b(seo|sem|google ads|meta ads|facebook ads|ppc|performance marketing|paid ads|ads)\b/ },
  { key: "social", label: "Social / content", rx: /\b(social|social media|content|copywriting|tiktok|instagram|video|photography|posting)\b/ },
  { key: "automation", label: "Automation / CRM / AI", rx: /\b(automation|crm|ghl|highlevel|zapier|make\.com|n8n|chatbots?|whatsapp|ai|integration)\b/ },
  { key: "it", label: "IT / cloud", rx: /\b(it support|cloud|aws|azure|cyber|network|devops)\b/ },
];
export const PARTNER_OOS = /\b(insurance agent|sell insurance|financial advis|property agent|real estate agent|mlm|crypto|forex|loan|network marketing)\b/;
export function detectServices(t) {
  const n = norm(t);
  return SERVICES.filter((s) => s.rx.test(n));
}

export const LOCATIONS = [
  { key: "SG", label: "Singapore", rx: /\b(singapore|sg|s'pore|ubi|tampines|jurong|woodlands|paya lebar|raffles|cbd|bugis|orchard|toa payoh|bedok|kallang|one-north|changi|ang mo kio|amk)\b/ },
  { key: "MY", label: "Malaysia", rx: /\b(malaysia|kl|kuala lumpur|johor|jb|penang|selangor|petaling)\b/ },
  { key: "ID", label: "Indonesia", rx: /\b(indonesia|jakarta|bali|surabaya|bandung)\b/ },
  { key: "PH", label: "Philippines", rx: /\b(philippines|manila|cebu|makati|davao)\b/ },
  { key: "VN", label: "Vietnam", rx: /\b(vietnam|hcmc|ho chi minh|saigon|hanoi|da nang)\b/ },
  { key: "TH", label: "Thailand", rx: /\b(thailand|bangkok|chiang mai)\b/ },
  { key: "IN", label: "India", rx: /\b(india|bangalore|bengaluru|mumbai|delhi|pune|chennai|hyderabad)\b/ },
];
export function detectLocation(t) {
  const n = norm(t);
  const hit = LOCATIONS.find((l) => l.rx.test(n));
  if (hit) return hit;
  const m = String(t).match(/based (?:in|at|out of)\s+([A-Z][\w-]+(?:\s[A-Z][\w-]+)?)/);
  return m ? { key: "OTHER", label: m[1] } : null;
}

// ---------- numeric extractors ----------
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100, a: 1 };

export function parseTeamSize(t) {
  const n = norm(t);
  if (/\b(just me|myself|solo|only me|one[- ]man|freelanc\w*|alone|1 man)\b/.test(n)) return { n: 1, text: "1 (solo)" };
  if (/\b(two of us|me and my (partner|wife|husband|cofounder|co-founder)|me and partner)\b/.test(n)) return { n: 2, text: "2" };
  let m = n.match(/(\d+)\s*(?:-|to|–|~)\s*(\d+)/);
  if (m) { const a = +m[1], b = +m[2]; return { n: Math.round((a + b) / 2), text: `${a}–${b}` }; }
  const all = [...n.matchAll(/(\d+)\s*\+?\s*(people|pax|staff|ppl|persons?|employees|of us|headcount|members|devs|developers|designers|engineers|full[- ]?time|ft)?/g)]
    .filter((x) => +x[1] < 5000 && !(+x[1] >= 1990 && +x[1] <= 2035));
  if (all.length) {
    // "8 devs + 2 designers" -> sum when units given on several numbers
    const withUnits = all.filter((x) => x[2]);
    const use = withUnits.length >= 2 ? withUnits : [all[0]];
    const total = use.reduce((s, x) => s + +x[1], 0);
    return { n: total, text: `${total}${/\+/.test(n) && use.length === 1 ? "+" : ""}` };
  }
  m = n.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|fifty|hundred)\b/);
  if (m) return { n: WORDNUM[m[1]], text: String(WORDNUM[m[1]]) };
  return null;
}

export function parseYears(t) {
  const n = norm(t);
  let m = n.match(/since\s+((?:19|20)\d\d)/) || n.match(/(?:started|founded|set up|established|began|est\.?)\s+(?:in\s+)?((?:19|20)\d\d)/) || n.match(/^((?:19|20)\d\d)$/);
  if (m) { const y = CURRENT_YEAR - +m[1]; return { years: Math.max(0, y), text: `${y} yrs (since ${m[1]})` }; }
  m = n.match(/(\d+(?:\.\d+)?)\s*\+?\s*(years?|yrs?)/);
  if (m) return { years: +m[1], text: `${m[1]} yrs` };
  m = n.match(/(\d+)\s*(months?|mths?)/);
  if (m) return { years: +m[1] / 12, text: `${m[1]} months` };
  if (/\b(just started|newly|new business|this year|few months|half a year|recently started)\b/.test(n)) return { years: 0.5, text: "<1 yr" };
  if (/\b(a year|one year)\b/.test(n)) return { years: 1, text: "1 yr" };
  if (/\b(few years|couple of years|several years)\b/.test(n)) return { years: 3, text: "~3 yrs" };
  m = n.match(/\b(two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)\s+(years?|yrs?)\b/);
  if (m) return { years: WORDNUM[m[1]], text: `${WORDNUM[m[1]]} yrs` };
  return null;
}

/** Money in SGD. assumeK: for budget/pricing slots a bare "12" means S$12k. */
export function parseMoney(t, { assumeK = false } = {}) {
  const raw = String(t || "");
  const s = norm(raw).replace(/,/g, "");
  const usd = /\b(usd|us\$)/.test(s);
  const hourly = /(\/\s*h(ou)?r|per hour|hourly|an hour|\/hr)/.test(s);
  const monthly = /(\/\s*m(on)?th|per month|monthly|a month|retainer)/.test(s);
  const hits = [...s.matchAll(/(s?\$|sgd\s*|usd\s*|us\$\s*)?(\d+(?:\.\d+)?)\s*(k\b|m\b|mil\b|million|thousand)?/g)]
    .filter((x) => !(+x[2] >= 1990 && +x[2] <= 2035 && !x[1] && !x[3]))
    .filter((x) => !/^\s*(pax|people|staff|months?|yrs?|years?|outlets?|cafes?|branches|%|per cent)/.test(s.slice(x.index + x[0].length, x.index + x[0].length + 10)));
  if (!hits.length) return null;
  const anyUnitK = hits.some((x) => x[3] && /^k|thousand/.test(x[3]));
  const anyCurrency = hits.some((x) => x[1]);
  if (!anyUnitK && !anyCurrency && !assumeK && !/budget|sgd|dollars?|bucks/.test(s)) return null;
  const vals = hits.map((x) => {
    let v = +x[2];
    const u = x[3] || "";
    if (/^k|thousand/.test(u)) v *= 1000;
    else if (/^m|mil|million/.test(u)) v *= 1_000_000;
    else if ((anyUnitK || assumeK) && v < 1000 && !hourly && !monthly) v *= 1000;
    return v;
  });
  const conv = usd ? 1.35 : 1;
  let min, max;
  if (vals.length >= 2) { min = Math.min(vals[0], vals[1]); max = Math.max(vals[0], vals[1]); }
  else if (/\b(below|under|less than|max|up to|within|no more than)\b|</.test(s)) { min = 0; max = vals[0]; }
  else if (/\b(above|over|more than|at least|min|minimum|from)\b|>|\+/.test(s)) { min = vals[0]; max = null; }
  else { min = vals[0]; max = vals[0]; }
  min = Math.round(min * conv); max = max == null ? null : Math.round(max * conv);
  const mid = max == null ? min : Math.round((min + max) / 2);
  const fmt = (v) => (v >= 1000 ? `S$${+(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `S$${v}`);
  let text = max == null ? `${fmt(min)}+` : min === max ? `~${fmt(min)}` : min === 0 ? `below ${fmt(max)}` : `${fmt(min)}–${fmt(max)}`;
  if (hourly) text += "/hr"; else if (monthly) text += "/mth";
  if (usd) text += " (from USD)";
  return { min, max, mid, hourly, monthly, text };
}

export function parseUrls(t) {
  const m = String(t || "").match(/\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|sg|io|co|net|org|agency|studio|design|dev|app|me|example|page|site)(?:\.[a-z]{2})?(?:\/[^\s,]*)?)/gi);
  return m ? [...new Set(m.map((u) => u.replace(/[).,]+$/, "")))] : [];
}

export function extractCompany(t) {
  const raw = String(t || "").trim().replace(/^(hi|hello|hey|hai|yo|morning|good (morning|afternoon|evening))\b[\s,!.]*/i, "");
  let m = raw.match(/([A-Z0-9][\w&'.-]*(?:\s+(?:[A-Z0-9][\w&'.-]*|&|and|of))*\s+(?:Pte\.?\s*Ltd\.?|Pte|LLP|Sdn\.?\s*Bhd\.?|Ltd\.?|Inc\.?|Studio|Studios|Agency|Labs|Digital|Media|Solutions|Group|Co\.?|Collective|Creative))/);
  if (m) return m[1].replace(/[.,]$/, "").trim();
  m = raw.match(/(?:we are|we're|i'm from|i am from|this is|called|company is|it's|its|from)\s+([A-Z][\w&'.-]*(?:\s+(?:[A-Z&][\w&'.-]*|&)){0,4})/);
  if (m) return m[1].trim();
  const first = raw.split(/[,—–(:;]| - |\bwe\b|\bbased\b/i)[0].trim();
  if (first && first.split(/\s+/).length <= 5 && /[a-z]/i.test(first)) return first.replace(/^(it'?s|its|we are|we're)\s+/i, "");
  return raw.slice(0, 40);
}
export function isRegistered(t) { return /\b(pte\.?\s*ltd|llp|sdn\.?\s*bhd|uen|acra|ltd|inc)\b/i.test(String(t)); }
