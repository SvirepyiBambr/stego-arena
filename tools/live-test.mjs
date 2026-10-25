// Live round against the deployed Stego Arena, via Chrome DevTools Protocol.
// Usage: POLL_KEY=sk_... node tools/live-test.mjs
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

// Load once, inject the key into this tab, reload: the app auto-connects.
await cdp("Page.navigate", { url: URL });
await sleep(2500);
await evaluate(`sessionStorage.setItem('stego-key', ${JSON.stringify(KEY)}); location.reload(); true`);
const connected = await waitFor(`document.getElementById('connect-status')?.textContent.includes('Connected') && document.getElementById('connect-status').textContent`, 120000);
console.log("CONNECTED:", connected);

// A secret that is easy to verify by eye, and a single shot with the full gauntlet.
await evaluate(`
  document.getElementById('secret').value = 'amber lantern over quiet water';
  document.getElementById('attempts').value = '1';
  document.getElementById('control').checked = true;
  document.getElementById('run').click(); true
`);

const verdict = await waitFor(`(() => { const t = document.getElementById('verdict').textContent.trim(); return t && !t.includes('Round failed') ? t : ''; })()`, 420000);
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
