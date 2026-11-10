// Live round against the deployed Stego Arena, via Chrome DevTools Protocol.
// Usage: POLL_KEY=sk_... node tools/live-test.mjs
// Knobs: SECRET, HIDER, SEEKER, ATTEMPTS, GAUNTLET=jpeg,resize, CONTROL=0.
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const KEY = process.env.POLL_KEY;
if (!KEY) throw new Error("POLL_KEY is required");
const URL = process.env.ARENA_URL || "https://svirepyibambr.github.io/stego-arena/";
const OUT = "docs/evidence";
mkdirSync(OUT, { recursive: true });

const chrome = spawn("chromium", [
  "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
  "--remote-debugging-port=9333", "--user-data-dir=/tmp/stego-arena-cdp",
  "--window-size=1200,1600", "about:blank",
], { stdio: "ignore" });

async function json(path) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch("http://127.0.0.1:9333" + path, { method: path.startsWith("/json/new") ? "PUT" : "GET" });
      return await r.json();
    } catch { await sleep(200); }
  }
  throw new Error("CDP not reachable");
}

const page = await json("/json/new?about:blank");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};
function cdp(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
  return r.result?.value;
}
async function waitFor(expr, timeout = 300000, every = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const v = await evaluate(expr);
    if (v) return v;
    await sleep(every);
  }
  throw new Error("timeout waiting for " + expr);
}

await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1600, deviceScaleFactor: 1, mobile: false });

// Load once, then hand the key straight to the Connect component: the
// consent screen itself needs a human, the component just exposes the key.
await cdp("Page.navigate", { url: URL });
await sleep(3000);
const injected = await evaluate(`(() => {
  const el = document.querySelector('polli-connect');
  if (!el) return 'no polli-connect element';
  el.apiKey = ${JSON.stringify(KEY)};
  el.dispatchEvent(new Event('change'));
  return 'ok';
})()`);
console.log("INJECT:", injected);
const connected = await waitFor(`document.getElementById('connect-status')?.textContent.includes('Connected') && document.getElementById('connect-status').textContent`, 120000);
console.log("CONNECTED:", connected);

const SECRET = process.env.SECRET || "red fox";
const HIDER = process.env.HIDER || "";
const SEEKER = process.env.SEEKER || "";
const ATTEMPTS = process.env.ATTEMPTS || "1";
const GAUNTLET = (process.env.GAUNTLET ?? "jpeg,resize").split(",").filter(Boolean);
const CONTROL = process.env.CONTROL !== "0";

await evaluate(`
  document.getElementById('secret').value = ${JSON.stringify(SECRET)};
  document.getElementById('attempts').value = ${JSON.stringify(ATTEMPTS)};
  document.getElementById('control').checked = ${CONTROL};
  for (const id of ['t-jpeg','t-resize','t-crop','t-bright']) {
    document.getElementById(id).checked = ${JSON.stringify(GAUNTLET)}.includes(id.slice(2));
  }
  ${HIDER ? `document.getElementById('hider').value = ${JSON.stringify(HIDER)};` : ""}
  ${SEEKER ? `document.getElementById('seeker').value = ${JSON.stringify(SEEKER)};` : ""}
  document.getElementById('run').click(); true
`);

let verdict;
try {
  verdict = await waitFor(`document.getElementById('verdict').textContent.trim()`, 900000);
} catch (e) {
  console.log("TIMEOUT; page log so far:\n" + await evaluate(`document.getElementById('log').textContent`));
  ws.close(); chrome.kill("SIGKILL"); throw e;
}
const logText = await evaluate(`document.getElementById('log').textContent`);

// Full-page screenshot.
const metrics = await cdp("Page.getLayoutMetrics");
const width = Math.ceil(metrics.cssContentSize.width);
const height = Math.ceil(metrics.cssContentSize.height);
const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
writeFileSync(`${OUT}/round.png`, Buffer.from(shot.data, "base64"));

writeFileSync(`${OUT}/round.json`, JSON.stringify({
  url: URL,
  ranAt: new Date().toISOString(),
  verdict,
  log: logText,
  secretImage: await evaluate(`document.getElementById('img-secret')?.src?.slice(0, 40) + '…'`),
}, null, 2));

console.log("VERDICT:", verdict.replace(/\s+/g, " "));
console.log("LOG:\n" + logText);
ws.close();
chrome.kill("SIGKILL");
