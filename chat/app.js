/* PartnerPulse SAMPLE — chat UI. Live mode = Express API (:3030). Static mode = same engine in-browser (GitHub Pages). */
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chat = $("#chat");
let T = null, mode = "prospect", view = null, speed = 1, busy = false, playToken = 0, prevReasons = new Set(), presets = [];

const MODE_HINT = {
  prospect: "A · Qualifies inbound prospects: need, company, team, current process, timeline, budget, decision maker → qualified / nurture / reject.",
  partner: "B · Onboards service-provider partners: services, company, team, industries, experience, project, portfolio, pricing, white-label, capacity.",
};

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
function serverTransport() {
  let sid = null;
  const keep = (j) => { sid = j.sessionId; return j; };
  return {
    kind: "live",
    presets: () => fetch("/api/presets").then((r) => r.json()),
    start: (m, presetId) => post("/api/session", { mode: m, presetId }).then(keep),
    send: (text) => post(`/api/session/${sid}/message`, { text }).then(keep),
    handoff: () => post(`/api/session/${sid}/handoff`, { reason: "operator_takeover" }).then(keep),
  };
}
async function staticTransport() {
  const E = await import("./engine.mjs");
  const P = await fetch("./presets.json").then((r) => r.json());
  let st = null;
  const wrap = (r) => {
    st = r.state;
    const evs = r.events.map((e) => ({ ...e, delivered: true, captureId: "browser" }));
    try { const all = JSON.parse(localStorage.getItem("pp_ghl_events") || "[]"); all.push(...evs.map((e) => ({ receivedAt: new Date().toISOString(), body: e }))); localStorage.setItem("pp_ghl_events", JSON.stringify(all.slice(-400))); } catch {}
    return { sessionId: st.id, replies: r.replies, events: evs, view: E.view(st) };
  };
  return {
    kind: "static",
    presets: async () => P,
    start: async (m, presetId) => { const p = P.presets.find((x) => x.id === presetId); return wrap(E.createSession({ mode: p?.mode || m, context: p?.context || null })); },
    send: async (text) => wrap(E.step(st, text)),
    handoff: async () => wrap(E.handoff(st, "operator_takeover")),
  };
}
async function detect() {
  if (!window.PP_STATIC) {
    try { const r = await fetch("/api/health", { cache: "no-store" }); if (r.ok && (await r.json()).brand) return serverTransport(); } catch {}
  }
  return staticTransport();
}

// ---------------- chat rendering
const hhmm = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
let lastSide = null;
function bubble(side, text) {
  const row = document.createElement("div");
  row.className = `msg ${side}` + (lastSide !== side ? " first" : "");
  lastSide = side;
  const b = document.createElement("div");
  b.className = "bub";
  b.textContent = text;
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.innerHTML = hhmm() + (side === "out" ? '<span class="tick">✓✓</span>' : "");
  b.appendChild(meta);
  row.appendChild(b);
  chat.appendChild(row);
  scroll();
  return row;
}
function quick(opts) {
  const q = document.createElement("div");
  q.className = "quick";
  for (const o of opts) {
    const btn = document.createElement("button");
    btn.textContent = o;
    btn.onclick = () => userSend(o);
    q.appendChild(btn);
  }
  chat.appendChild(q); scroll();
}
function system(text) { const c = document.createElement("div"); c.className = "chip sys"; c.textContent = text; chat.appendChild(c); lastSide = null; scroll(); }
function scroll() { chat.scrollTop = chat.scrollHeight; }
let typingEl = null;
function typing(on) {
  $("#waStatus").textContent = on ? "typing…" : "online";
  if (on && !typingEl) { typingEl = document.createElement("div"); typingEl.className = "msg in typing" + (lastSide !== "in" ? " first" : ""); typingEl.innerHTML = '<div class="bub"><span class="dots"><i></i><i></i><i></i></span></div>'; chat.appendChild(typingEl); scroll(); }
  if (!on && typingEl) { typingEl.remove(); typingEl = null; }
}
async function showReplies(replies) {
  for (const r of replies) {
    if (r.system) { await sleep(150 / speed); system(r.text); continue; }
    typing(true);
    await sleep(Math.min(1500, 380 + r.text.length * 9) / speed);
    typing(false);
    bubble("in", r.text);
    if (r.quick?.length) quick(r.quick);
  }
}
function disableQuick() { chat.querySelectorAll(".quick button").forEach((b) => (b.disabled = true)); }

// ---------------- console rendering
function applyView(v, events = []) {
  view = v;
  const sc = v.score;
  $("#stage").textContent = `${v.pipeline.name} · ${v.stageName}`;
  const band = $("#band");
  if (v.status === "active" && !sc.reasons.length) { band.textContent = "awaiting answers"; band.className = "band"; }
  else { band.textContent = sc.band; band.className = "band " + sc.band; }
  $("#scoreNum").textContent = sc.total;
  $("#complete").textContent = `${sc.completeness} fields`;
  $("#provisional").textContent = v.status === "active" ? "· live (provisional)" : `· final · ${v.status.replace("_", " ")}`;
  const MAX = 120, pct = (x) => Math.max(0, Math.min(100, (x / MAX) * 100));
  const fill = $("#scoreFill"); fill.style.width = pct(sc.total) + "%"; fill.className = "fill " + (sc.reasons.length ? sc.band : "");
  $("#thN").style.left = pct(sc.thresholds.n) + "%"; $("#thQ").style.left = pct(sc.thresholds.q) + "%";
  $("#lgN").textContent = `nurture ≥${sc.thresholds.n}`; $("#lgQ").textContent = `qualified ≥${sc.thresholds.q}`;
  const ul = $("#reasons"); ul.innerHTML = "";
  const now = new Set();
  if (!sc.reasons.length) ul.innerHTML = '<li class="muted">Answers will appear here as the agent scores them.</li>';
  for (const r of sc.reasons) {
    now.add(r.label);
    const li = document.createElement("li");
    if (r.hard) li.className = "hard";
    if (!prevReasons.has(r.label)) li.classList.add("new");
    li.innerHTML = `<span class="p ${r.pts > 0 ? "pos" : r.pts < 0 ? "neg" : "zero"}">${r.pts > 0 ? "+" : ""}${r.pts}</span><span></span>`;
    li.lastChild.textContent = r.label;
    ul.appendChild(li);
  }
  prevReasons = now;
  const sl = $("#slots"); sl.innerHTML = "";
  for (const s of v.slots) {
    const k = document.createElement("div"); k.className = "k" + (s.unclear ? " u" : s.filled ? " f" : ""); k.textContent = s.label;
    const d = document.createElement("div"); d.className = "v" + (s.filled ? "" : " empty"); d.textContent = s.filled ? s.display : "—";
    if (s.fromContext) d.insertAdjacentHTML("beforeend", '<span class="badge ctx">from website</span>');
    else if (s.harvested) d.insertAdjacentHTML("beforeend", '<span class="badge">auto-captured</span>');
    sl.append(k, d);
  }
  const hb = $("#handoffBtn"), hc = $("#handoffCard");
  hb.disabled = v.status === "handed_off" || v.status === "opted_out" || v.status === "rejected";
  if (v.handoff) {
    const h = v.handoff;
    hc.className = "";
    hc.innerHTML = `<div class="hcard"><b>→ ${esc(h.owner)} · ${esc(h.ownerRole)}</b>Reason: <code>${esc(h.reason)}</code><br/>Next step: ${esc(h.nextStep)}<br/>Score at handoff: ${h.score} (${esc(h.band)})<ul>${h.summary.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`;
  } else {
    hc.className = "muted small";
    hc.textContent = v.status === "active" ? `Auto-triggers when the lead is qualified, asks for a person, or stays skeptical. Or take over manually as ${v.owner.name}.` : `Conversation ${v.status.replace("_", " ")} — no handoff.`;
  }
  if (events.length) {
    const box = $("#events");
    if (box.querySelector(".muted")) box.innerHTML = "";
    for (const e of events) {
      const d = document.createElement("details"); d.className = "ev";
      const stage = e.body?.stageName ? ` → ${e.body.stageName}` : e.body?.title ? ` · ${e.body.title}` : "";
      d.innerHTML = `<summary><span class="et">${esc(e.type)}</span><span class="es">${esc(stage)}</span><span class="ew">${new Date(e.at).toLocaleTimeString([], { hour12: false })} <span class="${e.delivered === false ? "bad" : "ok"}">${e.delivered === false ? "✗ capture down" : "✓ captured"}</span></span></summary><pre></pre>`;
      d.querySelector("pre").textContent = `${e.request}\n${e.note}\n\n` + JSON.stringify(e.body, null, 2);
      box.prepend(d);
    }
    $("#evCount").textContent = `${box.children.length} events`;
  }
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function resetConsole() {
  $("#events").innerHTML = '<div class="muted small">Pipeline updates (contact upsert, stage moves, notes, tasks) appear here.</div>';
  $("#evCount").textContent = "0 events"; prevReasons = new Set();
}

// ---------------- flow
function setMode(m) {
  mode = m;
  document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  $("#modeHint").textContent = MODE_HINT[m];
}
async function startSession(m, presetId) {
  setMode(m);
  chat.querySelectorAll(".msg,.quick,.chip.sys").forEach((n) => n.remove()); lastSide = null;
  resetConsole();
  busy = true;
  const res = await T.start(m, presetId);
  if (res.view.context?.source) system(`Context carried over from ${res.view.context.source}: ${res.view.context.name} · ${res.view.context.company}`);
  applyView(res.view, res.events);
  await showReplies(res.replies);
  busy = false;
}
async function userSend(text) {
  text = String(text || "").trim();
  if (!text || busy) return;
  busy = true; disableQuick();
  bubble("out", text);
  $("#msg").value = "";
  try {
    const res = await T.send(text);
    await showReplies(res.replies);
    applyView(res.view, res.events);
  } catch (e) { system("Error: " + e.message); }
  busy = false;
}
async function typeInto(line, token) {
  const inp = $("#msg");
  inp.value = "";
  const per = Math.max(4, 26 / speed);
  for (const ch of line) { if (token !== playToken) return false; inp.value += ch; if (speed < 10) await sleep(per); }
  await sleep(180 / speed);
  return true;
}
async function playPreset(p, btn) {
  const token = ++playToken;
  document.querySelectorAll(".preset").forEach((b) => b.classList.remove("running"));
  btn?.classList.add("running");
  await startSession(p.mode, p.id);
  for (const line of p.script) {
    if (token !== playToken) return;
    if (view.status !== "active") break;
    await sleep(450 / speed);
    if (!(await typeInto(line, token))) return;
    while (busy) await sleep(50);
    await userSend(line);
  }
  btn?.classList.remove("running");
}

// ---------------- wire up
(async () => {
  T = await detect();
  const rm = $("#runmode");
  rm.textContent = T.kind === "live" ? "Live server · :3030" : "Static · engine runs in your browser";
  rm.className = "runmode " + T.kind;
  if (T.kind === "static") $("#proofLink").href = "proof.html";
  presets = (await T.presets()).presets;
  const box = $("#presets");
  for (const p of presets) {
    const b = document.createElement("button");
    b.className = "preset";
    b.innerHTML = `<div class="pt">▶ ${esc(p.title)}</div><div class="pp"><span class="pill mode">${p.mode === "prospect" ? "A · prospect" : "B · partner"}</span><span class="pill ${p.expect.startsWith("qualified") ? "qualified" : p.expect.startsWith("nurture") ? "nurture" : "reject"}">expect: ${esc(p.expect)}</span></div><div class="pb">${esc(p.blurb)}</div>`;
    b.onclick = () => playPreset(p, b);
    box.appendChild(b);
  }
  document.querySelectorAll(".seg button").forEach((b) => (b.onclick = () => { playToken++; startSession(b.dataset.mode); }));
  document.querySelectorAll(".speed button").forEach((b) => (b.onclick = () => { speed = +b.dataset.speed; document.querySelectorAll(".speed button").forEach((x) => x.classList.toggle("on", x === b)); }));
  document.querySelectorAll("#tries button").forEach((b) => (b.onclick = () => userSend(b.textContent)));
  $("#resetBtn").onclick = () => { playToken++; startSession(mode); };
  $("#composer").onsubmit = (e) => { e.preventDefault(); playToken++; userSend($("#msg").value); };
  $("#handoffBtn").onclick = async () => {
    if (busy) return; playToken++; busy = true;
    const res = await T.handoff(); await showReplies(res.replies); applyView(res.view, res.events); busy = false;
  };
  const q = new URLSearchParams(location.search);
  const auto = q.get("preset");
  if (q.get("speed")) { speed = +q.get("speed"); document.querySelectorAll(".speed button").forEach((x) => x.classList.toggle("on", +x.dataset.speed === speed)); }
  if (auto && presets.find((p) => p.id === auto)) { const i = presets.findIndex((p) => p.id === auto); playPreset(presets[i], box.children[i]); }
  else await startSession(q.get("mode") === "partner" ? "partner" : "prospect");
})();
