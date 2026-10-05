/**
 * PartnerPulse SAMPLE — conversation engine (deterministic, no LLM).
 * Isomorphic ES module: runs in Node (server.mjs) and in the browser (static Pages build).
 *
 * Design:
 *   - Slot-filling state machine per mode (prospect | partner), ONE question per bot turn.
 *   - Each answer is parsed by a slot extractor -> short reactive acknowledgement -> next question.
 *   - Opportunistic "harvest": details volunteered early (budget, team size, URLs...) fill later
 *     slots so the person is never asked twice.
 *   - Global interrupts: opt-out, ask-for-human, "are you a bot", skeptic, price/commission FAQ.
 *   - Vague answers get ONE re-ask with options, then the slot is marked "unclear" and we move on.
 *   - Heuristic scorer (lib/engine.mjs#score) -> qualified | nurture | reject, with visible reasons.
 *   - Emits MOCK GoHighLevel events (contact upsert / opportunity stage / note / task).
 *
 * SAMPLE / PORTFOLIO DEMO — PartnerPulse is a fictional brand. Not a client deliverable.
 */
import * as T from "./text.mjs";

export const BRAND = "PartnerPulse";
export const WATERMARK = "SAMPLE / PORTFOLIO DEMO — PartnerPulse (fictional brand)";
export const OWNERS = {
  prospect: { name: "Daniel Tan", first: "Daniel", role: "Solutions Lead", ghlUserId: "{{GHL_USER_ID_SALES}}" },
  partner: { name: "Wei Ling", first: "Wei Ling", role: "Partnerships", ghlUserId: "{{GHL_USER_ID_PARTNERSHIPS}}" },
};
export const PIPELINES = {
  prospect: {
    id: "{{GHL_PIPELINE_ID_PROSPECTS}}", name: "Prospects · WhatsApp agent",
    stages: [
      { id: "new", name: "New enquiry" }, { id: "qualifying", name: "AI qualifying" }, { id: "qualified", name: "Qualified" },
      { id: "handoff", name: "Human handoff" }, { id: "nurture", name: "Nurture" }, { id: "lost", name: "Unqualified / lost" },
    ],
  },
  partner: {
    id: "{{GHL_PIPELINE_ID_PARTNERS}}", name: "Partner pipeline",
    stages: [
      { id: "applied", name: "Applied" }, { id: "screening", name: "AI screening" }, { id: "review", name: "Human review" },
      { id: "nurture", name: "Talent pool" }, { id: "declined", name: "Declined" },
    ],
  },
};
const GHL_BASE = "https://services.leadconnectorhq.com";
const now = () => new Date().toISOString();
const clone = (o) => JSON.parse(JSON.stringify(o));
const genId = () => "pp_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

// ---------------------------------------------------------------- slots: PROSPECT
const PROSPECT_SLOTS = [
  {
    key: "need", label: "Need",
    ask: () => ({ text: "What are you looking to get help with?", quick: ["WhatsApp enquiries", "Sales follow-up / CRM", "Getting more leads"] }),
    reask: () => ({ text: "No problem. Which of these is closest?", quick: ["WhatsApp enquiries", "Sales follow-up / CRM", "Getting more leads"] }),
    parse(t) {
      const n = T.norm(t);
      const hits = T.NEEDS.filter((x) => x.rx.test(n));
      const hit = hits[0];
      if (hits.length >= 2 && hits[1].key !== "automation") return { value: hit.key, display: `${hit.label} + ${hits[1].label}`, ack: `Ok, ${hit.short} and ${hits[1].short}. We'd usually start with whichever is costing you more.` };
      if (hit) return { value: hit.key, display: hit.label, ack: hit.ack };
      if (!T.isVague(t) && n.split(" ").length >= 3) return { value: "other", display: T.cap(t.trim()).slice(0, 80), ack: "Ok, noted.", weak: true };
      return null;
    },
  },
  {
    key: "company", label: "Company",
    ask: () => ({ text: "Which company is this for, and what does the business do?" }),
    reask: () => ({ text: "Just the company name and what you do is enough — e.g. \"Lim & Co, renovation\"." }),
    parse(t) {
      if (T.isVague(t)) return null;
      const name = T.extractCompany(t);
      const ind = T.detectIndustries(t)[0];
      const r = { value: name, display: name, ack: ind ? ind.ack : T.pick(["Thanks.", "Got it, thanks."], t), flags: { registered: T.isRegistered(t) }, fills: {} };
      if (ind) r.fills.industry = { value: ind.key, display: ind.label, core: ind.core };
      return r;
    },
  },
  {
    key: "industry", label: "Industry",
    ask: (st) => ({ text: /[A-Z]/.test(st.slots.company?.value || "") ? `Which industry is ${st.slots.company.value} in?` : "Which industry are you in?", quick: ["F&B / retail", "Property / renovation", "Professional services"] }),
    reask: () => ({ text: "Roughly is fine — which of these is closest?", quick: ["F&B / retail", "Property / renovation", "Professional services"] }),
    parse(t) {
      const ind = T.detectIndustries(t)[0];
      if (ind) return { value: ind.key, display: ind.label, core: ind.core, ack: ind.ack };
      if (!T.isVague(t)) return { value: "other", display: T.cap(t.trim()).slice(0, 60), core: false, ack: "Ok, noted.", weak: true };
      return null;
    },
  },
  {
    key: "size", label: "Team size",
    ask: () => ({ text: "Roughly how many people are in the team?", quick: ["1–5", "6–30", "30+"] }),
    reask: () => ({ text: "A rough number is fine.", quick: ["1–5", "6–30", "30+"] }),
    parse(t) {
      const s = T.parseTeamSize(t);
      if (!s) return null;
      const ack = s.n <= 2 ? "Small team — so every hour saved counts." : s.n <= 30 ? "Ok, a lean team." : "At that size, routing and handover rules matter more.";
      return { value: s.n, display: `~${s.text}`, ack };
    },
  },
  {
    key: "current", label: "Current process",
    ask: (st) => {
      const need = st.slots.need?.value;
      if (need === "whatsapp") return { text: "How are WhatsApp enquiries handled today — someone replying manually?" };
      if (need === "crm") return { text: "Where do leads sit today — a spreadsheet, a CRM, or mostly in chats?" };
      if (need === "leads") return { text: "Where do most of your leads come from now?" };
      return { text: "How is this handled today?" };
    },
    reask: () => ({ text: "Just roughly — is it manual, a tool, or not really handled yet?", quick: ["Manual", "We have a tool", "Not handled yet"] }),
    parse(t) {
      if (T.isVague(t)) return null;
      const n = T.norm(t);
      const missed = /\b(miss\w*|slow|late|after hours?|after office|weekends?|night|lose|losing|lost|drop|forget|no time)\b/.test(n);
      const manual = /\b(manual\w*|myself|excel|sheets?|spreadsheet|by hand|staff|admin|whatsapp group|phone|no system|nothing|not handled|when free|managers?|i reply|we reply)\b/.test(n);
      const tool = /\b(crm|hubspot|salesforce|zoho|ghl|highlevel|pipedrive|tool|software|system)\b/.test(n) && !/no system/.test(n);
      const ack = missed ? "That's the expensive part — slow replies usually mean lost jobs."
        : tool ? "Ok, so there's a system already — we'd plug into it rather than replace it."
        : manual ? "Ok, so it's manual for now. That's very fixable." : "Understood.";
      return { value: T.cap(t.trim()).slice(0, 120), display: T.cap(t.trim()).slice(0, 90), ack, flags: { pain: missed || manual, missed, tool } };
    },
  },
  {
    key: "timeline", label: "Timeline",
    ask: () => ({ text: "When would you want this running?", quick: ["Within a month", "1–3 months", "Just exploring"] }),
    reask: () => ({ text: "Roughly is fine.", quick: ["Within a month", "1–3 months", "Just exploring"] }),
    parse(t) {
      const n = T.norm(t);
      if (/\b(asap|urgent\w*|this month|next week|within a month|in a month|\d+ weeks?|few weeks|now|immediately|yesterday|before (the )?(december|christmas|cny|chinese new year|year end))\b/.test(n))
        return { value: "urgent", display: "Within a month", ack: "Ok, tight but doable for a phase 1." };
      if (/\b(next month|1\s*[-–]\s*3|2 months|3 months|two months|three months|this quarter|q[1-4]|end of (the )?year|year end|january|february|march|april|may|june|july|august|september|october|november|december|cny)\b/.test(n))
        return { value: "1-3m", display: "1–3 months", ack: "That's a comfortable runway." };
      if (/\b(explor\w*|no rush|next year|6 months|six months|later|not sure yet|just looking|research\w*|someday|no timeline|see first)\b/.test(n))
        return { value: "exploring", display: "Exploring", ack: "Fair — early stage then, no pressure." };
      return null;
    },
  },
  {
    key: "budget", label: "Budget",
    ask: () => ({ text: "Do you have a budget range in mind? Ballpark is fine.", quick: ["Below S$5k", "S$5k–15k", "Above S$15k"] }),
    reask: () => ({ text: "Understood, it depends on scope. For context, most SME setups like this land between S$4k and S$15k one-off. Is that range workable?", quick: ["Yes, workable", "Lower than that", "Higher is fine"] }),
    parse(t, st) {
      const n = T.norm(t);
      const psg = /\b(psg|grant|edg|subsid\w*)\b/.test(n);
      let m = T.parseMoney(t, { assumeK: true });
      if (!m) {
        if (/\b(no budget|free|zero|nothing|0)\b/.test(n)) m = { min: 0, max: 0, mid: 0, text: "No budget" };
        else if ((st.vague.budget || 0) > 0 || /\bworkable|that range\b/.test(n)) {
          if (/\b(lower|less|below|cheaper|smaller|too much|cannot|can't)\b/.test(n)) m = { min: 2000, max: 4000, mid: 3000, text: "S$2k–4k" };
          else if (/\b(higher|more|above|bigger)\b/.test(n)) m = { min: 15000, max: null, mid: 15000, text: "S$15k+" };
          else if (/\b(yes|yep|ok|okay|workable|can|fine|sure|should be ok)\b/.test(n)) m = { min: 4000, max: 15000, mid: 9500, text: "S$4k–15k" };
        }
      }
      if (!m) return null;
      const v = m.max == null ? m.min : m.mid;
      let ack = v >= 15000 ? "That gives room for a proper setup, including the CRM side."
        : v >= 5000 ? "Workable for a solid phase 1."
        : v >= 3000 ? "Lean, but we can phase it."
        : v > 0 ? "That's below what a reliable build usually needs — noted." : "Noted.";
      if (psg) ack += " PSG may offset part of it — the team can confirm eligibility.";
      return { value: m, display: m.text + (psg ? " · PSG asked" : ""), ack, flags: { psg } };
    },
  },
  {
    key: "decision", label: "Decision maker",
    ask: () => ({ text: "Last one — are you the person deciding on this, or will others be involved?", quick: ["Me", "Me + partner/boss", "Someone else"] }),
    reask: () => ({ text: "Just so the team knows who to include.", quick: ["Me", "Me + partner/boss", "Someone else"] }),
    parse(t) {
      const n = T.norm(t);
      if (/\b(check|ask|discuss|confirm) with (my )?(partner|boss|co-?founder|wife|husband|director|team)/.test(n))
        return { value: "shared", display: "Shared decision", ack: "Ok, we can include them on the call." };
      if (/\b(someone else|not me|my boss|boss decides|manager decides|need to (check|ask)|have to ask|ask my)\b/.test(n))
        return { value: "other", display: "Someone else", ack: "Noted — we can prep a short summary you can forward." };
      if (/(\+|\band\b|\bwith\b|together|board|both|management|cofounder|co-founder|partners?\b|boss)/.test(n))
        return { value: "shared", display: "Shared decision", ack: "Ok, we can include them on the call." };
      if (/\b(me|i am|i'm|im|myself|owner|founder|director|ceo|md|yes|i decide|i do|mine)\b/.test(n))
        return { value: "self", display: "Self (decision maker)", ack: "Clear, thanks." };
      return null;
    },
  },
];

// ---------------------------------------------------------------- slots: PARTNER
const PARTNER_SLOTS = [
  {
    key: "services", label: "Services",
    ask: () => ({ text: "To start — what services does your team offer?", quick: ["Web / app development", "Design / branding", "Marketing / ads"] }),
    reask: () => ({ text: "Which is closest? You can add more later.", quick: ["Web / app development", "Design / branding", "Marketing / ads"] }),
    parse(t) {
      const sv = T.detectServices(t);
      if (!sv.length) {
        if (!T.isVague(t) && T.norm(t).split(" ").length >= 2) return { value: ["other"], display: T.cap(t.trim()).slice(0, 80), ack: "Ok, noted.", flags: { servicesCore: false }, weak: true };
        return null;
      }
      const keys = sv.map((s) => s.key);
      const labels = sv.map((s) => s.label);
      const ack = keys.includes("automation") ? "Automation and CRM — that's where most of our demand is right now, so useful."
        : keys.includes("web") || keys.includes("app") ? `${T.cap(T.listJoin(labels.map((l) => l.toLowerCase())))} — that's where most of our overflow sits.`
        : `${T.cap(T.listJoin(labels.map((l) => l.toLowerCase())))}, noted.`;
      return { value: keys, display: labels.join(", "), ack, flags: { servicesCore: true } };
    },
  },
  {
    key: "company", label: "Company",
    ask: () => ({ text: "What's the company name, and where are you based?" }),
    reask: () => ({ text: "Just the registered or trading name is fine, plus the city." }),
    parse(t) {
      if (T.isVague(t)) return null;
      const free = /\b(no company|freelanc\w*|just me|myself|sole prop\w*|not registered)\b/i.test(t);
      const name = free ? "Freelancer (no registered company)" : T.extractCompany(t);
      const loc = T.detectLocation(t);
      const ack = loc?.key === "SG" ? "Singapore-based, noted — helps for on-site work."
        : loc ? `${loc.label}, ok — we do work with regional teams.` : "Thanks.";
      return { value: name, display: name + (loc ? ` · ${loc.label}` : ""), ack, flags: { registered: T.isRegistered(t), location: loc?.key || null, regional: !!loc && loc.key !== "IN" && loc.key !== "OTHER" } };
    },
  },
  {
    key: "team_size", label: "Team size",
    ask: () => ({ text: "How big is the delivery team?", quick: ["Solo / freelancer", "2–10", "10+"] }),
    reask: () => ({ text: "A rough headcount is fine.", quick: ["Solo / freelancer", "2–10", "10+"] }),
    parse(t) {
      const s = T.parseTeamSize(t);
      if (!s) return null;
      const ack = s.n <= 1 ? "Ok, solo — we'd match you to well-scoped work then." : s.n <= 10 ? "Good size for project overflow." : "Ok, that's capacity for larger builds.";
      return { value: s.n, display: `~${s.text}`, ack };
    },
  },
  {
    key: "industries", label: "Industries",
    ask: () => ({ text: "Which industries do you mostly work with?" }),
    reask: () => ({ text: "Any 2–3 you've done the most work in?" }),
    parse(t) {
      const n = T.norm(t);
      if (/^(all|any|everything|all industries|any industry|many)$/.test(T.bare(t))) return null;
      const inds = T.detectIndustries(t);
      if (!inds.length) {
        if (T.isVague(t)) return null;
        return { value: ["other"], display: T.cap(t.trim()).slice(0, 60), ack: "Ok, noted.", flags: { coreOverlap: 0, count: 1 } };
      }
      const core = inds.filter((i) => i.core);
      const ack = core.length
        ? `${T.listJoin(inds.map((i) => i.label))} — noted. We have active demand in ${core[0].label} right now.`
        : `${T.listJoin(inds.map((i) => i.label))}, noted.`;
      return { value: inds.map((i) => i.key), display: inds.map((i) => i.label).join(", "), ack, flags: { coreOverlap: core.length, count: inds.length } };
    },
  },
  {
    key: "experience", label: "Experience",
    ask: () => ({ text: "How long has the team been doing this?" }),
    reask: () => ({ text: "Roughly how many years?", quick: ["Under 1 year", "2–4 years", "5+ years"] }),
    parse(t) {
      const n = T.norm(t);
      let y = T.parseYears(t);
      if (!y && /under 1|less than (a|1|one) year/.test(n)) y = { years: 0.5, text: "<1 yr" };
      if (!y && /2\s*[-–]\s*4/.test(n)) y = { years: 3, text: "2–4 yrs" };
      if (!y && /5\s*\+/.test(n)) y = { years: 5, text: "5+ yrs" };
      if (!y) return null;
      const ack = y.years >= 5 ? "Ok, established team." : y.years >= 2 ? "Noted." : "Ok, fairly new — the portfolio will matter more then.";
      return { value: y.years, display: y.text, ack };
    },
  },
  {
    key: "project", label: "Recent project",
    ask: () => ({ text: "Could you share one recent project — what the client needed and what you delivered?" }),
    reask: () => ({ text: "Could you add a line on the outcome? Even rough numbers help." }),
    parse(t, st) {
      if (T.isVague(t)) return null;
      const n = T.norm(t);
      if (n.length < 18 && !(st.vague.project > 0)) return null;
      const results = /(\d+\s?%|\d+x|\d+k\b|increase|grew|growth|launched|went live|cut|reduced|saved|leads|revenue|bookings|sales|conversion)/.test(n);
      return { value: T.cap(t.trim()).slice(0, 200), display: T.cap(t.trim()).slice(0, 90) + (t.trim().length > 90 ? "…" : ""), ack: results ? "Useful — measurable results help when we put partners forward to clients." : "Thanks, that helps.", flags: { results, detailed: n.length >= 40 } };
    },
  },
  {
    key: "portfolio", label: "Portfolio",
    ask: () => ({ text: "Do you have a portfolio or case study link I can pass to the team?" }),
    reask: () => ({ text: "A website, Behance, Dribbble or a PDF link all work. If you don't have one, just say so." }),
    parse(t) {
      const n = T.norm(t);
      const urls = T.parseUrls(t);
      if (urls.length) return { value: urls, display: urls.join(" · "), ack: urls.length > 1 ? "Got them, I'll attach both for review." : "Got it, I'll attach that for review.", flags: { hasPortfolio: true } };
      if (/\bnda\b|confidential|can't share|cannot share/.test(n)) return { value: [], display: "Under NDA (deck to follow)", ack: "Understood. A redacted deck works too — you can send it here later.", flags: { hasPortfolio: false, nda: true } };
      if (/\b(later|will send|send you|tomorrow|after this)\b/.test(n)) return { value: [], display: "To follow", ack: "Sure, send it here whenever ready — I'll attach it to your file.", flags: { hasPortfolio: false, later: true } };
      if (/\b(no|don'?t have|dont have|not yet|nope|none|nothing yet)\b/.test(n)) return { value: [], display: "None", ack: "Ok, noted.", flags: { hasPortfolio: false } };
      return null;
    },
  },
  {
    key: "pricing", label: "Typical project size",
    ask: () => ({ text: "What's a typical project size for you? A range is fine.", quick: ["Below S$5k", "S$5k–20k", "Above S$20k"] }),
    reask: () => ({ text: "Ballpark per project is enough.", quick: ["Below S$5k", "S$5k–20k", "Above S$20k"] }),
    parse(t) {
      const m = T.parseMoney(t, { assumeK: !/\b(hour|hr|month|mth)\b/i.test(t) });
      if (!m) return null;
      const v = m.hourly ? m.mid * 120 : m.monthly ? m.mid * 3 : (m.max == null ? m.min : m.mid);
      const ack = m.hourly ? "Ok, hourly — we usually scope per project, but that's workable."
        : v < 2000 ? "Noted — on the small side, more suited to scoped tasks."
        : v <= 60000 ? "Ok, that sits within the range we usually refer." : "Ok, larger builds — useful for enterprise-type referrals.";
      return { value: m, display: m.text, ack, flags: { projectValue: v } };
    },
  },
  {
    key: "whitelabel", label: "White-label",
    skip: (st) => { const s = st.slots.services?.value || []; return s.length > 0 && s.every((k) => k === "it" || k === "other"); },
    ask: () => ({ text: "Are you open to white-label work — delivering under our brand, with us handling the client?", quick: ["Yes", "Case by case", "Prefer not"] }),
    reask: () => ({ text: "Just a yes / no / depends is fine.", quick: ["Yes", "Case by case", "Prefer not"] }),
    parse(t) {
      const n = T.norm(t);
      if (/\b(case by case|depends|sometimes|maybe|possibly|for the right)\b/.test(n)) return { value: "case", display: "Case by case", ack: "Fair, we'd flag which jobs are white-label upfront." };
      if (/\b(prefer not|no|not keen|own brand|rather not|don'?t do)\b/.test(n) && !/\bno problem\b/.test(n)) return { value: "no", display: "No", ack: "Ok, we'll only send co-branded or direct referrals then." };
      if (/\b(yes|yep|open|sure|can|ok|okay|done before|already do|already|of course|definitely)\b/.test(n)) return { value: "yes", display: "Yes" + (/already|done before/.test(n) ? " (experienced)" : ""), ack: "Good — most of our referrals are white-label, so that widens what we can send you." };
      return null;
    },
  },
  {
    key: "capacity", label: "Capacity",
    ask: () => ({ text: "Last question — how many new projects could you take on per month?", quick: ["1", "2–3", "4+"] }),
    reask: () => ({ text: "Rough number per month?", quick: ["1", "2–3", "4+"] }),
    parse(t) {
      const n = T.norm(t);
      if (/^(many|a lot|lots|unlimited|any|as many)/.test(n)) return { value: 0, display: "\"Many\" (unspecified)", ack: "Noted — we'll confirm real capacity on review.", flags: { unclear: true } };
      const s = T.parseTeamSize(t);
      if (!s) return null;
      return { value: s.n, display: `${s.text}/mth`, ack: "Noted." };
    },
  },
];

export const SLOTS = { prospect: PROSPECT_SLOTS, partner: PARTNER_SLOTS };
export function slotList(mode) { return SLOTS[mode].map((s) => ({ key: s.key, label: s.label })); }
function nextSlot(st) {
  return SLOTS[st.mode].find((s) => !st.slots[s.key] && !(s.skip && s.skip(st))) || null;
}

// ---------------------------------------------------------------- harvest (no repeated questions)
function harvest(st, t, currentKey) {
  const got = [];
  const n = T.norm(t);
  const fill = (key, r) => { if (!st.slots[key] && key !== currentKey) { st.slots[key] = { ...r, harvested: true }; got.push(SLOTS[st.mode].find((s) => s.key === key)?.label.toLowerCase()); } };
  if (st.mode === "prospect") {
    const m = T.parseMoney(t);
    if (m && /\b(budget|k\b|\$|sgd)/.test(n)) { const r = PROSPECT_SLOTS[6].parse(t, st); if (r) fill("budget", r); }
    if (/\b(people|pax|staff|employees|headcount|just me|myself|solo|only me)\b/.test(n)) { const s = T.parseTeamSize(t); if (s) fill("size", { value: s.n, display: `~${s.text}` }); }
    const tl = PROSPECT_SLOTS[5].parse(t); if (tl && tl.value === "urgent" && /\b(asap|urgent|this month|next week|immediately)\b/.test(n)) fill("timeline", tl);
    if (currentKey === "need" || currentKey === "company") { const ind = T.detectIndustries(t)[0]; if (ind) fill("industry", { value: ind.key, display: ind.label, core: ind.core }); }
  } else {
    const urls = T.parseUrls(t); if (urls.length) fill("portfolio", { value: urls, display: urls.join(" · "), flags: { hasPortfolio: true } });
    const y = T.parseYears(t); if (y && currentKey !== "capacity") fill("experience", { value: y.years, display: y.text });
    if (/\b(people|pax|staff|devs|developers|designers|engineers|-person|person team|team of|just me|freelanc\w*|solo)\b/.test(n)) { const s = T.parseTeamSize(t); if (s) fill("team_size", { value: s.n, display: `~${s.text}` }); }
    if (/white[- ]?label/.test(n) && currentKey !== "whitelabel") { const r = PARTNER_SLOTS[8].parse(t); if (r) fill("whitelabel", r); }
    if (/\b(per project|projects? (are|is|usually)|usually s?\$)/.test(n)) { const m = T.parseMoney(t); if (m) fill("pricing", { value: m, display: m.text, flags: { projectValue: m.mid } }); }
    if (currentKey === "services" || currentKey === "company") { const loc = T.detectLocation(t); if (loc && st.slots.company && !st.slots.company.flags?.location) st.slots.company.flags = { ...st.slots.company.flags, location: loc.key }; }
  }
  return got.filter(Boolean);
}

// ---------------------------------------------------------------- scoring
export function score(st) {
  const s = st.slots; const R = []; let hard = null;
  const add = (pts, label) => R.push({ pts, label });
  if (st.mode === "prospect") {
    if (s.need) { s.need.value === "other" ? add(5, "Need captured (non-core)") : add(15, `In-scope need: ${s.need.display}`); }
    if (st.flags.softOos) add(-30, "Signals: free / student / school project");
    if (s.company) { add(5, "Company identified"); if (s.company.flags?.registered) add(5, "Registered entity (Pte Ltd / UEN)"); }
    if (s.industry) s.industry.core ? add(10, `Core industry: ${s.industry.display}`) : add(2, `Industry: ${s.industry.display} (non-core)`);
    if (s.size && s.size.value != null) { const v = s.size.value; v >= 10 ? add(10, `Team ~${v} — enough enquiry volume`) : v >= 3 ? add(5, `Team ~${v}`) : add(0, "Solo / micro team — lower volume"); }
    if (s.current) { if (s.current.flags?.missed) add(12, "Clear pain: missed / slow replies"); else if (s.current.flags?.pain) add(8, "Manual process today"); if (s.current.flags?.tool) add(3, "Existing system to integrate"); }
    if (s.timeline) { const v = s.timeline.value; v === "urgent" ? add(15, "Timeline < 1 month") : v === "1-3m" ? add(10, "Timeline 1–3 months") : v === "exploring" ? add(-5, "Just exploring") : add(0, "Timeline unclear"); }
    if (s.budget) {
      const b = s.budget.value;
      if (!b) add(0, "Budget unclear");
      else { const v = b.max == null ? b.min : b.mid;
        if (v >= 15000) add(25, `Budget ${b.text} — healthy`); else if (v >= 5000) add(18, `Budget ${b.text} — workable`);
        else if (v >= 3000) add(8, `Budget ${b.text} — lean`); else if (v > 0) add(-15, `Budget ${b.text} — below minimum`);
        else { add(-30, "No budget"); hard = "No budget"; } }
      if (s.budget.flags?.psg) add(3, "Asked about PSG grant (SG-ready buyer)");
    }
    if (s.decision) { const v = s.decision.value; v === "self" ? add(10, "Talking to decision maker") : v === "shared" ? add(6, "Shared decision") : add(0, "Not the decision maker"); }
  } else {
    if (s.services) s.services.flags?.servicesCore === false ? add(3, "Services: non-core") : add(15, `In-scope services: ${s.services.display}`);
    if (s.company) { /^Freelancer/.test(s.company.value) ? add(2, "Freelancer (no registered entity)") : add(5, "Company identified"); if (s.company.flags?.registered) add(5, "Registered entity"); if (s.company.flags?.location === "SG") add(5, "Singapore-based"); else if (s.company.flags?.regional) add(3, "SEA-based"); }
    if (s.team_size && s.team_size.value != null) { const v = s.team_size.value; v >= 5 ? add(10, `Team ~${v} — real delivery capacity`) : v >= 2 ? add(5, `Team ~${v}`) : add(2, "Solo freelancer"); }
    if (s.industries) { const f = s.industries.flags || {}; if ((f.count || 0) >= 2) add(5, "Multi-industry experience"); if (f.coreOverlap) add(5, "Overlaps our demand industries"); }
    if (s.experience && s.experience.value != null) { const v = s.experience.value; v >= 5 ? add(15, `${s.experience.display} experience`) : v >= 2 ? add(10, `${s.experience.display} experience`) : v >= 1 ? add(3, "~1 yr experience") : add(-10, "Under 1 year in business"); }
    if (s.project) { if (s.project.flags?.results) add(10, "Project with measurable outcome"); else if (s.project.flags?.detailed) add(6, "Project described"); else add(2, "Project — thin detail"); }
    if (s.portfolio) { if (s.portfolio.flags?.hasPortfolio) add(15, "Portfolio link provided"); else if (s.portfolio.flags?.nda || s.portfolio.flags?.later) add(3, "Portfolio to follow"); else add(-10, "No portfolio to review"); }
    if (s.pricing && s.pricing.value) { const v = s.pricing.flags?.projectValue ?? s.pricing.value.mid; v >= 3000 && v <= 80000 ? add(10, `Project size ${s.pricing.value.text} fits referral range`) : v > 80000 ? add(5, `Enterprise-size projects (${s.pricing.value.text})`) : add(-5, `Project size ${s.pricing.value.text} — very small`); }
    if (s.whitelabel) { const v = s.whitelabel.value; v === "yes" ? add(10, "Open to white-label") : v === "case" ? add(5, "White-label case by case") : add(0, "No white-label"); }
    if (s.capacity && s.capacity.value) { s.capacity.value >= 2 ? add(5, `Capacity ${s.capacity.display}`) : add(2, `Capacity ${s.capacity.display}`); }
    if (s.experience && s.experience.value < 1 && s.portfolio && !s.portfolio.flags?.hasPortfolio) hard = "New (<1 yr) and no portfolio";
  }
  if (st.skeptic) add(-3 * st.skeptic, `Skeptical signals ×${st.skeptic}`);
  if (st.flags.hardOos) hard = st.flags.hardOos;
  const total = R.reduce((a, r) => a + r.pts, 0);
  if (hard) R.push({ pts: 0, label: `Hard stop: ${hard}`, hard: true });
  const th = st.mode === "prospect" ? { q: 65, n: 35 } : { q: 70, n: 40 };
  const band = hard ? "reject" : total >= th.q ? "qualified" : total >= th.n ? "nurture" : "reject";
  const all = SLOTS[st.mode].filter((x) => !(x.skip && x.skip(st)));
  const filled = all.filter((x) => st.slots[x.key]).length;
  return { total, band, hardReject: hard, reasons: R, thresholds: th, completeness: `${filled}/${all.length}`, provisional: st.status === "active" };
}

// ---------------------------------------------------------------- GHL mock payloads
function stageName(st, id) { return PIPELINES[st.mode].stages.find((s) => s.id === id)?.name || id; }
function contactBody(st) {
  const c = st.context || {}; const s = st.slots;
  const [firstName, ...rest] = (c.name || "").split(" ");
  return {
    locationId: "{{GHL_LOCATION_ID}}",
    firstName: firstName || null, lastName: rest.join(" ") || null,
    phone: c.phone || "+65 9000 0000 (SAMPLE)",
    companyName: s.company?.value || c.company || null,
    source: c.source || "WhatsApp agent (web mirror demo)",
    tags: ["wa-agent", st.mode === "prospect" ? "prospect" : "partner-applicant", ...(st.score ? [`ai-${st.score.band}`] : [])],
    customFields: Object.entries(s).map(([k, v]) => ({ key: `pp_${k}`, field_value: v.display })),
  };
}
function oppBody(st, stageId, extra = {}) {
  const s = st.slots; const sc = st.score || {};
  const val = st.mode === "prospect" ? (s.budget?.value ? (s.budget.value.max == null ? s.budget.value.min : s.budget.value.mid) : 0) : (s.pricing?.flags?.projectValue || 0);
  return {
    locationId: "{{GHL_LOCATION_ID}}", pipelineId: PIPELINES[st.mode].id, pipelineName: PIPELINES[st.mode].name,
    pipelineStageId: `{{STAGE_${stageId.toUpperCase()}}}`, stageKey: stageId, stageName: stageName(st, stageId),
    name: `${s.company?.value || st.context?.company || "Unknown"} — ${st.mode === "prospect" ? (s.need?.display || "enquiry") : "partner application"}`,
    status: extra.status || "open", monetaryValue: val, contactId: `{{contact_id:${st.id}}}`,
    customFields: [{ key: "ai_score", field_value: sc.total }, { key: "ai_band", field_value: sc.band }, { key: "ai_reasons", field_value: (sc.reasons || []).map((r) => `${r.pts >= 0 ? "+" : ""}${r.pts} ${r.label}`).join(" | ") }],
    ...extra,
  };
}
function emit(st, type, method, path, body) {
  const ev = { seq: st.events.length + 1, at: now(), sessionId: st.id, mode: st.mode, type, mock: true, request: `${method} ${GHL_BASE}${path}`, note: "MOCK — not sent to GoHighLevel; posted to local capture", body, watermark: WATERMARK };
  st.events.push(ev);
  return ev;
}
function moveStage(st, stageId, extra) {
  st.stage = stageId;
  emit(st, "opportunity.upsert", "POST", "/opportunities/upsert", oppBody(st, stageId, extra));
}
function upsertContact(st) {
  st.contactUpserted = true;
  emit(st, "contact.upsert", "POST", "/contacts/upsert", contactBody(st));
}

// ---------------------------------------------------------------- summaries
export function summaryLines(st) {
  return SLOTS[st.mode].filter((x) => st.slots[x.key]).map((x) => `${x.label}: ${st.slots[x.key].display ?? "—"}`);
}
function noteBody(st, title) {
  const sc = st.score;
  return { contactId: `{{contact_id:${st.id}}}`, body: [`${title}`, ...summaryLines(st).map((l) => `• ${l}`), `AI score: ${sc.total} (${sc.band})`, ...sc.reasons.map((r) => `  ${r.pts >= 0 ? "+" : ""}${r.pts} ${r.label}`), `Transcript: ${st.transcript.length} msgs · session ${st.id}`].join("\n") };
}

// ---------------------------------------------------------------- copy
function greeting(st) {
  const c = st.context;
  if (st.mode === "prospect") {
    if (c?.name) {
      const first = c.name.split(" ")[0];
      return [
        { text: `Hi ${first}, this is PartnerPulse's AI assistant. I can see your enquiry from our website (${c.page || "contact form"}), so no need to repeat that.` },
        ask(st),
      ];
    }
    return [
      { text: "Hi, thanks for messaging PartnerPulse. I'm the team's AI assistant — a few quick questions so the right person can follow up properly." },
      ask(st),
    ];
  }
  return [
    { text: "Hi, thanks for your interest in partnering with PartnerPulse." },
    { text: "Quick context: we deliver automation and digital projects for SMEs in Singapore and the region, and bring in vetted partners for delivery — some under your brand, some white-label under ours. About 5 minutes, one question at a time." },
    ask(st),
  ];
}
function ask(st, re = false) {
  const s = nextSlot(st);
  if (!s) return null;
  const q = re ? s.reask(st) : s.ask(st);
  return { text: q.text, quick: q.quick, slot: s.key };
}
const SKEPTIC_LINES = [
  "Fair to ask. Short answer: we only take on projects where the numbers make sense for you — if it doesn't, we'll say so upfront.",
  "Understood. No commitment here — I'm only getting enough detail so nobody wastes your time on a call.",
  "That's reasonable. We can share two SG case studies with actual reply-time numbers before you decide anything.",
];
function asideFor(st, n) {
  const I = T.INTENT; const out = [];
  if (I.scam.test(n)) out.push("You reached us through our website / WhatsApp link — we don't cold-message. If you'd rather stop here, just say stop.");
  if (st.mode === "prospect" && I.price.test(n)) out.push("Depends on scope. Most SME setups like this land between S$4k and S$15k one-off, plus small running costs (WhatsApp API fees, hosting). Some are PSG-claimable. A few more details and the team can give you a proper number.");
  if (st.mode === "partner" && (I.commission.test(n) || (I.price.test(n) && /\b(you pay|we get|paid)\b/.test(n)))) out.push("Project-based — rates are agreed per job before you start, and paid within 30 days of each milestone. Partnerships will walk you through it at review.");
  if (I.whatIs.test(n)) out.push(st.mode === "prospect"
    ? "PartnerPulse (fictional SAMPLE brand) sets up WhatsApp agents, CRM pipelines and automation for SMEs in Singapore."
    : "We get more project demand than our core team can deliver, so we refer work to vetted partners — web, design, marketing and automation mainly.");
  if (I.howLong.test(n)) out.push("Typically 2–4 weeks for a phase 1, depending on integrations.");
  if (I.integrate.test(n)) out.push("Yes — GHL, HubSpot, Google Sheets and most tools with an API.");
  if (st.mode === "prospect" && /\b(psg|grant)\b/.test(n) && nextSlot(st)?.key !== "budget" && !st.slots.budget) out.push("On PSG: some pre-approved solutions qualify. The team will confirm what applies once we know the scope.");
  return out;
}

// ---------------------------------------------------------------- public API
export function createSession({ mode = "prospect", context = null, id } = {}) {
  if (!SLOTS[mode]) throw new Error("mode must be prospect | partner");
  const st = {
    id: id || genId(), brand: BRAND, watermark: WATERMARK, mode, context, createdAt: now(), turn: 0,
    slots: {}, flags: {}, vague: {}, skeptic: 0, pending: null, status: "active",
    stage: mode === "prospect" ? "new" : "applied", score: null, transcript: [], events: [], handoff: null, contactUpserted: false, outcome: null,
  };
  if (context?.prefill) for (const [k, v] of Object.entries(context.prefill)) st.slots[k] = { ...v, fromContext: true };
  st.score = score(st);
  if (context?.name) { upsertContact(st); moveStage(st, mode === "prospect" ? "qualifying" : "screening"); }
  const replies = greeting(st);
  return finish(st, replies, 0);
}

export function step(st0, text) {
  const st = clone(st0);
  const evStart = st.events.length;
  const t = String(text || "").trim().slice(0, 1000);
  const n = T.norm(t);
  st.turn++;
  st.transcript.push({ from: "user", text: t, at: now() });
  const out = [];

  if (st.status === "handed_off") {
    emit(st, "conversation.inbound", "POST", "/conversations/messages/inbound", { contactId: `{{contact_id:${st.id}}}`, type: "WhatsApp", message: t, assignedTo: st.handoff.ownerId });
    return finish(st, [{ system: true, text: `Bot paused — message routed to ${st.handoff.owner} (human). In the live build this lands in GHL Conversations.` }], evStart);
  }
  if (st.status === "nurture" || st.status === "qualified") {
    if (T.INTENT.human.test(n) || /\b(speak to someone|someone now)\b/.test(n)) return doHandoff(st, "user_requested_human", evStart);
    if (T.INTENT.optOut.test(n)) { st.status = "opted_out"; moveStage(st, st.mode === "prospect" ? "lost" : "declined", { status: "abandoned", lostReason: "Opted out on WhatsApp" }); return finish(st, [{ text: "Understood, I'll stop here and won't message again. Take care." }], evStart); }
    emit(st, "note.create", "POST", `/contacts/{{contact_id:${st.id}}}/notes`, { contactId: `{{contact_id:${st.id}}}`, body: `Follow-up message from lead: ${t}` });
    return finish(st, [{ text: `Noted, I've added that to your file. If you'd like to speak to ${OWNERS[st.mode].first} directly, just say so.` }], evStart);
  }
  if (st.status !== "active") return finish(st, [{ system: true, text: "This demo conversation is closed. Hit Reset or pick another sample lead." }], evStart);

  // --- pending confirmations
  const p = st.pending; st.pending = null;
  if (p && (p.type === "offer_human" || p.type === "fasttrack")) {
    if (/\b(continue|carry on|go on|not now|later|here|no)\b/.test(n)) { out.push({ text: T.pick(["Sure, continuing.", "Ok, let's continue."], st.turn) }); out.push(ask(st)); return finish(st, out, evStart); }
    if (/\b(yes|yep|ok|okay|sure|get|person|human|now|please|daniel|wei ling|connect)\b/.test(n)) return doHandoff(st, p.type === "fasttrack" ? "high_intent_fasttrack" : "user_accepted_human", evStart);
  }
  if (p && p.type === "close_cta") {
    if (/\b(no|not yet|later|not now|maybe later|think first)\b/.test(n) && !/\bno problem\b/.test(n)) {
      st.status = "qualified"; st.outcome = "qualified_follow_up"; st.score = score(st);
      moveStage(st, "qualified");
      emit(st, "note.create", "POST", `/contacts/{{contact_id:${st.id}}}/notes`, noteBody(st, "AI qualified — prospect wants time before a call"));
      emit(st, "task.create", "POST", `/contacts/{{contact_id:${st.id}}}/tasks`, { title: "Send relevant case study + follow up in 5 working days", assignedTo: OWNERS.prospect.ghlUserId, dueDate: "+5 business days" });
      out.push({ text: `No problem. I'll send a short case study${st.slots.industry ? ` from ${st.slots.industry.display}` : ""} and check back next week. If you want to speak to someone earlier, just message here.` });
      return finish(st, out, evStart);
    }
    st.flags.preferredTime = t;
    return doHandoff(st, "qualified_call_requested", evStart);
  }

  // --- global interrupts
  const cur = nextSlot(st);
  const yesNoSlot = cur && ["whitelabel", "decision", "portfolio"].includes(cur.key);
  if (T.INTENT.optOut.test(n) && !yesNoSlot) {
    st.status = "opted_out"; st.outcome = "opted_out"; st.score = score(st);
    if (!st.contactUpserted) upsertContact(st);
    moveStage(st, st.mode === "prospect" ? "lost" : "declined", { status: "abandoned", lostReason: "Opted out on WhatsApp" });
    emit(st, "contact.tag", "POST", `/contacts/{{contact_id:${st.id}}}/tags`, { tags: ["DND-whatsapp", "opted-out"] });
    return finish(st, [{ text: "Understood, I'll stop here and won't message again. Take care." }], evStart);
  }
  if (T.INTENT.human.test(n)) return doHandoff(st, "user_requested_human", evStart);
  if (cur && (cur.key === "need" || cur.key === "services")) {
    const oos = st.mode === "prospect" ? T.HARD_OOS : T.PARTNER_OOS;
    if (oos.test(n)) {
      st.flags.hardOos = st.mode === "prospect" ? "Out of scope (job / crypto / lending etc.)" : "Services outside our partner scope";
      return closeReject(st, evStart, st.mode === "prospect"
        ? "Ah, this line is for business enquiries on automation and digital projects, so I won't be able to help with that. For roles, careers@partnerpulse.example is the right contact."
        : "Thanks for reaching out. Our partner programme is for digital delivery teams (web, design, marketing, automation), so this one isn't a fit. All the best.");
    }
    if (st.mode === "prospect" && T.SOFT_OOS.test(n)) st.flags.softOos = true;
  }
  if (T.INTENT.bot.test(n)) {
    st.pending = { type: "offer_human" };
    out.push({ text: `Yes, I'm an AI assistant for PartnerPulse. The team reviews every chat, and a person can take over anytime. Shall I continue, or would you prefer ${OWNERS[st.mode].first} now?`, quick: ["Continue", `Get ${OWNERS[st.mode].first}`] });
    return finish(st, out, evStart);
  }
  const asides = [];
  if (T.INTENT.skeptic.test(n)) {
    st.skeptic++;
    asides.push(SKEPTIC_LINES[(st.skeptic - 1) % SKEPTIC_LINES.length]);
    if (st.skeptic >= 2) {
      st.pending = { type: "offer_human" };
      out.push({ text: asides[0] });
      out.push({ text: `Might be easier to speak to someone directly. Want me to get ${OWNERS[st.mode].first} to message you here?`, quick: [`Yes, get ${OWNERS[st.mode].first}`, "Continue here"] });
      return finish(st, out, evStart);
    }
  }
  asides.push(...asideFor(st, n));

  if (!cur) return evaluate(st, out, evStart);

  // --- slot parse
  const FREE_TEXT = ["company", "current", "project"];
  let r = (asides.length && FREE_TEXT.includes(cur.key)) ? null : cur.parse(t, st);
  if (r && r.weak && (asides.length || /\?\s*$/.test(t))) r = null;
  if (r) {
    const { fills, weak, ...rest } = r;
    st.slots[cur.key] = { ...rest, raw: t };
    for (const [k, v] of Object.entries(fills || {})) if (!st.slots[k]) st.slots[k] = { ...v, harvested: true };
    const got = harvest(st, t, cur.key);
    let ack = r.ack || "Noted.";
    if (got.length) ack += ` Noted on the ${T.listJoin(got)} too.`;
    for (const a of asides) out.push({ text: a });
    if (cur.key === "company" && !st.contactUpserted) { upsertContact(st); moveStage(st, st.mode === "prospect" ? "qualifying" : "screening"); }
    st.score = score(st);
    // high-intent fast track (prospect)
    const b = st.slots.budget?.value; const nx = nextSlot(st);
    if (st.mode === "prospect" && nx && !st.flags.fastOffered && b && (b.max == null ? b.min : b.mid) >= 15000 && st.slots.timeline?.value === "urgent") {
      st.flags.fastOffered = true; st.pending = { type: "fasttrack" };
      out.push({ text: ack });
      out.push({ text: `Given the timeline and budget, this is worth a direct conversation. Want me to get ${OWNERS.prospect.first} on this chat now, or shall I take the last couple of details first?`, quick: [`Get ${OWNERS.prospect.first} now`, "Continue here"] });
      return finish(st, out, evStart);
    }
    if (!nx) { out.push({ text: ack }); return evaluate(st, out, evStart); }
    out.push({ text: ack });
    out.push(ask(st));
    return finish(st, out, evStart);
  }
  if (asides.length) { for (const a of asides) out.push({ text: a }); out.push(ask(st)); return finish(st, out, evStart); }
  // cross-fill: the answer didn't fit THIS question but clearly answers another one -> keep it, don't ask again later
  if (!T.isVague(t)) {
    for (const other of SLOTS[st.mode]) {
      if (other.key === cur.key || st.slots[other.key] || (other.skip && other.skip(st))) continue;
      if (FREE_TEXT.includes(other.key) && other.key !== "current") continue;
      const o = other.parse(t, st);
      if (!o || o.weak) continue;
      if (other.key === "current" && !(o.flags?.pain || o.flags?.tool)) continue;
      const { fills, weak, ...rest } = o;
      st.slots[other.key] = { ...rest, raw: t, harvested: true };
      st.score = score(st);
      out.push({ text: o.ack || "Noted." });
      if ((st.vague[cur.key] || 0) >= 1) {
        st.slots[cur.key] = { value: null, display: "unclear", unclear: true, raw: t };
        st.score = score(st);
        if (!nextSlot(st)) return evaluate(st, out, evStart);
        out.push(ask(st));
      } else {
        st.vague[cur.key] = 1;
        const q = cur.ask(st);
        out.push({ text: `And ${q.text.charAt(0).toLowerCase()}${q.text.slice(1)}`, quick: q.quick, slot: cur.key });
      }
      return finish(st, out, evStart);
    }
  }
  st.vague[cur.key] = (st.vague[cur.key] || 0) + 1;
  if (st.vague[cur.key] <= 1) {
    if (!T.isVague(t) && T.norm(t).split(" ").length > 2) out.push({ text: "Sorry, I didn't quite catch that." });
    out.push(ask(st, true));
    return finish(st, out, evStart);
  }
  st.slots[cur.key] = { value: null, display: "unclear", unclear: true, raw: t };
  st.score = score(st);
  out.push({ text: ["budget", "timeline", "decision", "pricing", "capacity"].includes(cur.key) ? "No problem, the team can cover that on the call." : "No problem — we can come back to that." });
  if (!nextSlot(st)) return evaluate(st, out, evStart);
  out.push(ask(st));
  return finish(st, out, evStart);
}

export function handoff(st0, reason = "operator_takeover") {
  const st = clone(st0);
  if (st.status === "handed_off") return finish(st, [{ system: true, text: "Already with a human." }], st.events.length);
  return doHandoff(st, reason, st.events.length);
}

function evaluate(st, out, evStart) {
  st.score = score(st);
  const band = st.score.band;
  if (!st.contactUpserted) upsertContact(st);
  if (st.mode === "prospect") {
    if (band === "qualified") {
      st.pending = { type: "close_cta" }; st.outcome = "qualified";
      moveStage(st, "qualified");
      out.push({ text: `Thanks, that's clear. From what you've shared, this is a good fit for a phase-1 build${st.slots.timeline?.value === "urgent" ? " on your timeline" : ""}.` });
      out.push({ text: `Shall I get ${OWNERS.prospect.first}, our ${OWNERS.prospect.role}, to WhatsApp you for a 20-min call? Any time that suits?`, quick: ["Yes, tomorrow afternoon", "Yes, this week", "Not yet"] });
      return finish(st, out, evStart);
    }
    if (band === "nurture") {
      st.status = "nurture"; st.outcome = "nurture";
      moveStage(st, "nurture");
      emit(st, "note.create", "POST", `/contacts/{{contact_id:${st.id}}}/notes`, noteBody(st, "AI: nurture — not ready for a build yet"));
      emit(st, "workflow.enroll", "POST", `/contacts/{{contact_id:${st.id}}}/workflow/{{GHL_WORKFLOW_NURTURE}}`, { workflow: "30-day nurture (case studies)" });
      out.push({ text: "Thanks for the detail. It sounds a bit early for a full build, so I won't push a call." });
      out.push({ text: `I'll send over a couple of short examples${st.slots.industry?.display ? ` relevant to ${st.slots.industry.display}` : ""} and check in again in about a month. If things move sooner, just message here.`, quick: ["Speak to someone now"] });
      return finish(st, out, evStart);
    }
    return closeReject(st, evStart, "Appreciate you sharing. To be straight, this probably isn't a fit right now — our builds start around S$3k and work best where there's steady enquiry volume. If that changes, do message again.", out);
  }
  // partner
  if (band === "qualified") return doHandoff(st, "qualified_partner_review", evStart, out);
  if (band === "nurture") {
    st.status = "nurture"; st.outcome = "talent_pool";
    moveStage(st, "nurture");
    emit(st, "note.create", "POST", `/contacts/{{contact_id:${st.id}}}/notes`, noteBody(st, "AI: partner → talent pool"));
    out.push({ text: "Thanks, that's everything I need." });
    out.push({ text: `I'll keep your profile in our partner pool and match you when a project fits ${st.slots.services ? st.slots.services.display.toLowerCase() : "your services"}.${st.slots.portfolio?.flags?.hasPortfolio ? "" : " Sending a portfolio link here later will move you up the list."}` });
    return finish(st, out, evStart);
  }
  return closeReject(st, evStart, "Thanks for your time. To be upfront, we're currently onboarding teams with at least 2 years of delivery and work we can review, so I won't route this for now. You're welcome to apply again once that's in place.", out);
}

function closeReject(st, evStart, text, out = []) {
  st.score = score(st); st.status = "rejected"; st.outcome = "rejected";
  if (!st.contactUpserted) upsertContact(st);
  moveStage(st, st.mode === "prospect" ? "lost" : "declined", { status: "lost", lostReason: st.score.hardReject || `AI score ${st.score.total} below threshold` });
  emit(st, "note.create", "POST", `/contacts/{{contact_id:${st.id}}}/notes`, noteBody(st, "AI: not a fit — closed politely"));
  out.push({ text });
  return finish(st, out, evStart);
}

function doHandoff(st, reason, evStart, out = []) {
  st.score = score(st);
  const o = OWNERS[st.mode];
  const prevStatus = st.status;
  st.status = "handed_off"; st.pending = null;
  st.outcome = st.outcome || reason;
  if (!st.contactUpserted) upsertContact(st);
  const nextStep = {
    qualified_call_requested: `Book 20-min discovery call (prospect preference: "${st.flags.preferredTime || "any"}")`,
    high_intent_fasttrack: "Reply within 15 min — high intent (budget + urgent timeline)",
    user_requested_human: "Prospect asked for a person — reply on WhatsApp within 1h",
    user_accepted_human: "Prospect accepted human offer — reply on WhatsApp within 1h",
    qualified_partner_review: "Review portfolio + schedule 15-min partner call",
    operator_takeover: "Operator took over from console",
  }[reason] || "Follow up";
  st.handoff = { reason, owner: o.name, ownerRole: o.role, ownerId: o.ghlUserId, at: now(), nextStep, summary: summaryLines(st), score: st.score.total, band: st.score.band };
  moveStage(st, st.mode === "prospect" ? "handoff" : "review", { assignedTo: o.ghlUserId });
  emit(st, "note.create", "POST", `/contacts/{{contact_id:${st.id}}}/notes`, noteBody(st, `HANDOFF → ${o.name} (${reason})`));
  emit(st, "task.create", "POST", `/contacts/{{contact_id:${st.id}}}/tasks`, { title: nextStep, assignedTo: o.ghlUserId, dueDate: reason === "high_intent_fasttrack" ? "+15 minutes" : "+1 business hour" });
  emit(st, "conversation.assign", "PUT", `/conversations/{{conversation_id:${st.id}}}`, { assignedTo: o.ghlUserId, botPaused: true });

  if (reason === "qualified_partner_review") {
    out.push({ text: "Thanks, that's everything I need." });
    out.push({ text: `Your profile looks like a strong fit, so I'm routing it to ${o.name} on our partnerships team for review. She'll reply here within 2 working days, usually with a short call slot.` });
  } else if (reason === "operator_takeover") {
    out.push({ system: true, text: `${o.name} (${o.role}) joined the chat — bot paused. Notes and score shared internally.` });
  } else if (reason === "qualified_call_requested") {
    out.push({ text: `Done. ${o.first} will WhatsApp you on this chat to confirm the slot — usually within the hour on working days (Mon–Fri, 9am–6pm SGT).` });
    out.push({ text: "He has your notes, so you won't need to repeat yourself." });
  } else {
    const he = st.mode === "prospect" ? "He" : "She";
    out.push({ text: `Sure — I'm passing this to ${o.first} from our ${st.mode === "prospect" ? "team" : "partnerships team"} now. ${he}'ll continue on this same chat${prevStatus === "active" ? "" : " shortly"}.` });
    out.push({ text: `${he} has the notes so far, so no need to repeat anything.` });
  }
  out.push({ system: true, text: `Handoff → ${o.name} · GHL stage "${stageName(st, st.stage)}" · task created` });
  return finish(st, out, evStart);
}

function finish(st, replies, evStart) {
  const rs = replies.filter(Boolean);
  for (const r of rs) st.transcript.push({ from: r.system ? "system" : "bot", text: r.text, quick: r.quick, at: now() });
  if (st.status === "active" || !st.score) st.score = score(st);
  else st.score = { ...score(st), provisional: false };
  return { state: st, replies: rs, events: st.events.slice(evStart) };
}

/** Thin public view for UIs. */
export function view(st) {
  const slots = SLOTS[st.mode].filter((s) => !(s.skip && s.skip(st))).map((s) => ({ key: s.key, label: s.label, filled: !!st.slots[s.key], display: st.slots[s.key]?.display ?? null, harvested: !!st.slots[s.key]?.harvested, fromContext: !!st.slots[s.key]?.fromContext, unclear: !!st.slots[s.key]?.unclear }));
  return { id: st.id, mode: st.mode, status: st.status, stage: st.stage, stageName: stageName(st, st.stage), pipeline: PIPELINES[st.mode], score: st.score, slots, handoff: st.handoff, pending: st.pending, context: st.context, owner: OWNERS[st.mode], turn: st.turn, outcome: st.outcome, eventsCount: st.events.length };
}
