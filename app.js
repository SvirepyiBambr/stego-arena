// Stego Arena — hide-and-seek for image steganography on Pollinations.
// Static app: no backend, no build step. The reader's key stays in this tab.

const API = "https://gen.pollinations.ai";
const STORE = "stego-arena-v1";
const $ = (id) => document.getElementById(id);

const state = {
  key: "",
  models: [],
  ratings: {},
  rounds: [],
  last: null, // {secret, png, controlPng, hider, seeker, transforms, answer, result}
};

const WORDS = ["amber", "lantern", "quiet", "water", "harbor", "velvet", "copper", "meadow", "silent", "orbit", "willow", "cinder", "marble", "north", "paper", "tiger", "lemon", "shadow", "river", "glass"];

// ---------- storage ----------

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || "{}");
    state.rounds = raw.rounds || [];
    state.ratings = raw.ratings || {};
  } catch { /* ignore */ }
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ rounds: state.rounds, ratings: state.ratings }));
  } catch { /* ignore */ }
}

// ---------- helpers ----------

function log(msg) {
  const el = $("log");
  el.textContent += (el.textContent ? "\n" : "") + msg;
  el.scrollTop = el.scrollHeight;
}

function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9а-яё]+/gi, " ").trim().replace(/\s+/g, " ");
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

function judge(secret, answer) {
  const s = norm(secret);
  const t = norm(answer?.text || "");
  const hidden = answer?.hidden === true;
  if (!hidden || !t) return "missed";
  if (t === s || (s.length > 5 && t.includes(s))) return "exact";
  if (similarity(s, t) >= 0.62) return "partial";
  const sTokens = s.split(" ").filter(Boolean);
  const tTokens = new Set(t.split(" ").filter(Boolean));
  const hit = sTokens.filter((w) => tTokens.has(w)).length;
  if (sTokens.length && hit / sTokens.length >= 0.66) return "partial";
  return "wrong";
}

function rating(key) { return state.ratings[key] || 1200; }
function updateElo(hider, seeker, hiderScore) {
  const kh = `hider:${hider}`, ks = `seeker:${seeker}`;
  const rh = rating(kh), rs = rating(ks);
  const eh = 1 / (1 + 10 ** ((rs - rh) / 400));
  const K = 20;
  state.ratings[kh] = Math.round(rh + K * (hiderScore - eh));
  state.ratings[ks] = Math.round(rs + K * ((1 - hiderScore) - (1 - eh)));
}

function randomPhrase() {
  const pick = () => WORDS[Math.floor(Math.random() * WORDS.length)];
  return `${pick()} ${pick()} ${pick()}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = src;
  });
}

async function toCanvas(dataUrl, size = 768) {
  const img = await loadImage(dataUrl);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const s = Math.min(size / (img.width || size), size / (img.height || size));
  ctx.drawImage(img, (size - img.width * s) / 2, (size - img.height * s) / 2, img.width * s, img.height * s);
  return c;
}

// ---------- Pollinations ----------

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.key}`,
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${body.slice(0, 220)}`);
  }
  return res.json();
}

async function chat(model, messages, maxTokens = 4000, temperature = 0.8) {
  const data = await api("/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });
  let content = data?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) content = content.map((p) => p.text || "").join("");
  return (content || "").trim();
}

async function connect() {
  const key = $("key").value.trim();
  const status = $("connect-status");
  if (!key) { status.textContent = "Paste a key first."; status.className = "status err"; return; }
  status.textContent = "Checking key and loading models…";
  status.className = "status";
  try {
    state.key = key;
    sessionStorage.setItem("stego-key", key);
    const models = await api("/models");
    state.models = models;
    fillModels(models);
    status.textContent = `Connected. ${models.length} models available, your key is used for every call.`;
    status.className = "status ok";
    $("run").disabled = false;
    estimate();
  } catch (e) {
    state.key = "";
    status.textContent = `Could not connect: ${e.message}`;
    status.className = "status err";
  }
}

function fillModels(models) {
  const text = models.filter((m) => m.category === "text" && (m.supported_endpoints || []).includes("/v1/chat/completions"));
  const vision = text.filter((m) => (m.input_modalities || []).includes("image"));
  const opts = (list) => list.map((m) => `<option value="${m.name}">${m.title || m.name}</option>`).join("");
  $("hider").innerHTML = opts(text);
  $("seeker").innerHTML = opts(vision);
  const pick = (list, wanted) => list.find((m) => m.name === wanted)?.name || list[0]?.name;
  $("hider").value = pick(text, "openai/gpt-5.4");
  $("seeker").value = pick(vision, "openai/gpt-5.4-nano");
}

function price(modelName, kind) {
  const m = state.models.find((x) => x.name === modelName);
  const p = m?.pricing || {};
  return Number(p[kind] || 0);
}

function estimate() {
  const h = $("hider").value, s = $("seeker").value;
  if (!h || !s) return;
  const hiderCost = price(h, "promptTextTokens") * 900 + price(h, "completionTextTokens") * 3500;
  const seekerCost = price(s, "promptTextTokens") * 1400 + price(s, "completionTextTokens") * 200;
  const total = hiderCost + seekerCost;
  const control = $("control").checked ? " + control image" : "";
  $("estimate").textContent = `Rough cost per attempt: ${total.toFixed(5)} Pollen${control}. Live prices from /models; images may add provider-specific charges.`;
}

// ---------- rendering ----------

function extractSvg(text) {
  const match = text.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) throw new Error("model did not return an SVG");
  let svg = match[0];
  if (!/xmlns=/.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (!/viewBox=/.test(svg) && !/width=/.test(svg)) svg = svg.replace(/<svg/i, '<svg width="768" height="768"');
  return svg;
}

async function svgToPng(svg) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const c = document.createElement("canvas");
    c.width = c.height = 768;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 768, 768);
    const s = Math.min(768 / (img.width || 768), 768 / (img.height || 768));
    ctx.drawImage(img, (768 - img.width * s) / 2, (768 - img.height * s) / 2, img.width * s, img.height * s);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function gauntlet(dataUrl) {
  let c = await toCanvas(dataUrl);
  if ($("t-jpeg").checked) {
    c = await toCanvas(c.toDataURL("image/jpeg", 0.72));
  }
  if ($("t-resize").checked) {
    const small = document.createElement("canvas");
    small.width = small.height = 553;
    small.getContext("2d").drawImage(c, 0, 0, 553, 553);
    const back = document.createElement("canvas");
    back.width = back.height = 768;
    back.getContext("2d").drawImage(small, 0, 0, 768, 768);
    c = back;
  }
  if ($("t-crop").checked) {
    const cropped = document.createElement("canvas");
    cropped.width = cropped.height = 768;
    const inset = 23;
    cropped.getContext("2d").drawImage(c, inset, inset, 768 - inset * 2, 768 - inset * 2, 0, 0, 768, 768);
    c = cropped;
  }
  if ($("t-bright").checked) {
    const ctx = c.getContext("2d");
    const data = ctx.getImageData(0, 0, 768, 768);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = Math.min(255, data.data[i] + 8);
      data.data[i + 1] = Math.min(255, data.data[i + 1] + 5);
      data.data[i + 2] = Math.max(0, data.data[i + 2] - 4);
    }
    ctx.putImageData(data, 0, 0);
  }
  return c.toDataURL("image/png");
}

function transformList() {
  const list = [];
  if ($("t-jpeg").checked) list.push("jpeg");
  if ($("t-resize").checked) list.push("resize");
  if ($("t-crop").checked) list.push("crop");
  if ($("t-bright").checked) list.push("brightness");
  return list;
}

// ---------- prompts ----------

const HIDER_PROMPT = (secret, feedback) => `You are drawing an SVG illustration, 768x768, that hides a short secret phrase as a puzzle.

SECRET: "${secret}"

Hide it so a careful viewer who knows to look can recover it, but a casual glance sees only an ordinary scene. You may encode it in the first letters of objects in a row, object positions, colors, shapes, repeated elements, or subtle lettering blended into the scene. Do not write the phrase as plain readable text and do not put it in a title, comment or metadata.

It must look like a normal illustration: one clear scene, no explanation, no legend.

${feedback ? `A previous attempt failed. Feedback: ${feedback}\nChange the encoding and make it more discoverable.` : ""}

Output ONLY the <svg>...</svg> element. No markdown, no prose.`;

const CONTROL_PROMPT = `Draw an ordinary SVG illustration, 768x768, in the same style as a scene that could contain a hidden puzzle: one clear scene with several objects. Do not hide any message, do not encode any text, do not add lettering, comments or metadata. Output ONLY the <svg>...</svg> element. No markdown, no prose.`;

const SEEKER_PROMPT = `You are given an image. Another model may have hidden a short English phrase in it, with no agreed scheme. Look carefully for encodings: first letters of objects, a row of objects, positions, colors, counts, shapes, or subtle lettering.

Answer with JSON only:
{"hidden": true|false, "text": "the phrase if you found one, else empty", "confidence": 0.0-1.0, "where": "short description of the clue"}

If you see nothing, return hidden=false. Do not guess wildly.`;

// ---------- round ----------

async function runRound() {
  const hider = $("hider").value;
  const seeker = $("seeker").value;
  const secret = $("secret").value.trim() || randomPhrase();
  const attempts = Number($("attempts").value);
  if (!state.key) { alert("Connect a key first."); return; }

  $("run").disabled = true;
  $("stage-card").classList.remove("hidden");
  $("log").textContent = "";
  $("verdict").className = "verdict";
  $("verdict").textContent = "";
  $("img-secret").removeAttribute("src");
  $("control-fig").classList.add("hidden");

  let feedback = "";
  let final = null;

  try {
    let controlPng = null;
    if ($("control").checked) {
      log("Control: drawing a paired image with no secret…");
      const csvg = extractSvg(await chat(hider, [{ role: "user", content: CONTROL_PROMPT }], 6000, 0.7));
      controlPng = await gauntlet(await svgToPng(csvg));
      $("img-control").src = controlPng;
      $("control-fig").classList.remove("hidden");
    }

    for (let attempt = 1; attempt <= attempts; attempt++) {
      log(`Attempt ${attempt}/${attempts}: ${hider} is drawing…`);
      const svg = extractSvg(await chat(hider, [{ role: "user", content: HIDER_PROMPT(secret, feedback) }], 6000, 0.85));
      log(`SVG received (${svg.length} chars). Rasterizing and stripping metadata…`);
      const png = await gauntlet(await svgToPng(svg));
      $("img-secret").src = png;

      log(`Gauntlet: ${transformList().join(", ") || "none"}. Asking ${seeker}…`);
      const raw = await chat(seeker, [{
        role: "user",
        content: [
          { type: "text", text: SEEKER_PROMPT },
          { type: "image_url", image_url: { url: png } },
        ],
      }], 500, 0.2);

      let answer;
      try {
        const json = raw.match(/\{[\s\S]*\}/)?.[0] || raw;
        answer = JSON.parse(json);
      } catch {
        answer = { hidden: /yes|hidden|нашёл|found/i.test(raw), text: raw.slice(0, 120), confidence: 0.3, where: "unstructured answer" };
      }

      const result = judge(secret, answer);
      final = { secret, png, controlPng, hider, seeker, transforms: transformList(), answer, result, attempt };
      log(`Seeker says: ${JSON.stringify(answer)}`);
      log(`Verdict: ${result.toUpperCase()}`);

      state.rounds.push({
        ts: new Date().toISOString(),
        hider, seeker, secret, answer, result, attempt,
        transforms: transformList(),
        control: Boolean(controlPng),
      });

      if (controlPng) {
        log("Control check: asking the seeker about the image with nothing hidden…");
        const craw = await chat(seeker, [{
          role: "user",
          content: [
            { type: "text", text: SEEKER_PROMPT },
            { type: "image_url", image_url: { url: controlPng } },
          ],
        }], 400, 0.2);
        let ca;
        try { ca = JSON.parse(craw.match(/\{[\s\S]*\}/)?.[0] || craw); } catch { ca = { hidden: false, text: craw.slice(0, 80) }; }
        const falseAlarm = ca.hidden === true;
        state.rounds[state.rounds.length - 1].control_answer = ca;
        state.rounds[state.rounds.length - 1].false_alarm = falseAlarm;
        log(falseAlarm ? `False alarm on control: "${ca.text || "?"}"` : "Control clean: no false alarm.");
      }

      const hiderScore = result === "exact" ? 0 : result === "partial" ? 0.5 : 1;
      updateElo(hider, seeker, hiderScore);
      save();
      renderBoard();

      if (result === "exact" || result === "partial") break;
      feedback = `The seeker answered hidden=${answer.hidden}, text="${answer.text || ""}". It did not recover the phrase.`;
    }

    state.last = final;
    renderVerdict(final);
  } catch (e) {
    log(`ERROR: ${e.message}`);
    $("verdict").className = "verdict bad";
    $("verdict").textContent = `Round failed: ${e.message}`;
  } finally {
    $("run").disabled = false;
    save();
    renderBoard();
    estimate();
  }
}

function renderVerdict(r) {
  const v = $("verdict");
  const cls = r.result === "exact" ? "good" : r.result === "partial" ? "warn" : "bad";
  v.className = `verdict ${cls}`;
  const conf = typeof r.answer?.confidence === "number" ? ` (confidence ${r.answer.confidence})` : "";
  const text = r.answer?.text ? `“${r.answer.text}”` : "nothing";
  const label = { exact: "EXACT — the seeker recovered the phrase", partial: "PARTIAL — close, but not exact", wrong: "WRONG — it found something else", missed: "MISSED — it saw nothing" }[r.result];
  v.innerHTML = `<b>${label}</b><br>Secret: <code>${escapeHtml(r.secret)}</code> · Seeker answered ${escapeHtml(text)}${conf}<br>` +
    `<span class="muted">Attempt ${r.attempt} · ${escapeHtml(r.hider)} → ${escapeHtml(r.seeker)} · gauntlet: ${r.transforms.join(", ") || "none"}</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- leaderboard ----------

function pairs() {
  const map = new Map();
  for (const r of state.rounds) {
    const k = `${r.hider} → ${r.seeker}`;
    if (!map.has(k)) map.set(k, { hider: r.hider, seeker: r.seeker, rounds: 0, exact: 0, partial: 0, missed: 0, wrong: 0, fa: 0 });
    const p = map.get(k);
    p.rounds += 1;
    p[r.result] = (p[r.result] || 0) + 1;
    if (r.false_alarm) p.fa += 1;
  }
  return [...map.values()].sort((a, b) => b.rounds - a.rounds);
}

function renderBoard() {
  const tbody = $("board").querySelector("tbody");
  tbody.innerHTML = pairs().map((p) => {
    const win = (p.exact + 0.5 * p.partial) / p.rounds;
    return `<tr><td>${escapeHtml(p.hider)} → ${escapeHtml(p.seeker)}</td><td>${p.rounds}</td><td>${p.exact}</td><td>${p.partial}</td><td>${p.missed}</td><td>${p.fa}</td><td>${(win * 100).toFixed(0)}%</td><td>${rating("hider:" + p.hider)} / ${rating("seeker:" + p.seeker)}</td></tr>`;
  }).join("") || `<tr><td colspan="8" class="muted">No rounds yet.</td></tr>`;
}

function exportData() {
  const payload = { app: "stego-arena", exported: new Date().toISOString(), ratings: state.ratings, rounds: state.rounds };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `stego-arena-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- human mode ----------

function humanMode() {
  if (!state.last?.png) return;
  $("human-card").classList.remove("hidden");
  $("img-human").src = state.last.png;
  $("human-verdict").textContent = "";
  $("human-card").scrollIntoView({ behavior: "smooth" });
}

function judgeHuman() {
  if (!state.last) return;
  const guess = $("human-text").value.trim();
  const result = judge(state.last.secret, { hidden: Boolean(guess), text: guess });
  const v = $("human-verdict");
  v.className = `verdict ${result === "exact" ? "good" : result === "partial" ? "warn" : "bad"}`;
  v.innerHTML = `<b>${result.toUpperCase()}</b> — secret was <code>${escapeHtml(state.last.secret)}</code>. ` +
    (result === "exact" ? "You found it." : result === "partial" ? "Close." : "Not this time.");
  state.rounds.push({
    ts: new Date().toISOString(), hider: state.last.hider, seeker: "human",
    secret: state.last.secret, answer: { hidden: Boolean(guess), text: guess }, result,
    attempt: state.last.attempt, transforms: state.last.transforms, control: false,
  });
  save();
  renderBoard();
}

// ---------- wire up ----------

load();
renderBoard();

$("connect").addEventListener("click", connect);
$("key").addEventListener("keydown", (e) => { if (e.key === "Enter") connect(); });
$("dice").addEventListener("click", () => { $("secret").value = randomPhrase(); });
$("run").addEventListener("click", runRound);
$("again").addEventListener("click", () => { $("secret").value = randomPhrase(); runRound(); });
$("human").addEventListener("click", humanMode);
$("human-submit").addEventListener("click", judgeHuman);
$("export").addEventListener("click", exportData);
$("clear").addEventListener("click", () => {
  if (!confirm("Clear all rounds and ratings in this browser?")) return;
  state.rounds = []; state.ratings = {}; save(); renderBoard();
});
$("copy").addEventListener("click", async () => {
  const rows = [["hider", "seeker", "rounds", "exact", "partial", "missed", "false_alarms", "seeker_win_rate"]];
  for (const p of pairs()) rows.push([p.hider, p.seeker, p.rounds, p.exact, p.partial, p.missed, p.fa, ((p.exact + 0.5 * p.partial) / p.rounds).toFixed(3)]);
  await navigator.clipboard.writeText(rows.map((r) => r.join("\t")).join("\n"));
});
for (const id of ["hider", "seeker", "control", "t-jpeg", "t-resize", "t-crop", "t-bright"]) {
  $(id).addEventListener("change", estimate);
}

// restore key for this tab
const savedKey = sessionStorage.getItem("stego-key");
if (savedKey) { $("key").value = savedKey; connect(); }
