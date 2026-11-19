// capture.mjs — deterministic screenshot capture via headless Chromium CDP.
// Usage: node qa/capture.mjs <outDir> [shot ...]   (default: board chase mission results)
// Serves game/ on a local port, loads each ?shot= page twice (two independent
// sets), writes <shot>.jpg per set, and prints sizes + ERROR-banner status.
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';

const outDir = process.argv[2] || 'qa/set1';
const shots = process.argv.slice(3).length ? process.argv.slice(3) : ['board', 'chase', 'mission', 'results'];
const root = new URL('../game/', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const file = join(root, p === '/' ? 'index.html' : p);
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const dbgPort = 19000 + Math.floor(Math.random() * 2000);
const CHROME = process.env.CHROME_BIN || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell';
// --enable-unsafe-swiftshader (real3d round): chrome-headless-shell runs with
// --disable-gpu, under which WebGL context creation FAILS outright; the flag
// enables the SwiftShader software GL stack so the Three.js renderer can run
// in captures at all (verified by a probe page: WebGL 2.0 via SwiftShader,
// drawImage composite of the WebGL canvas reads back correctly).
const chrome = spawn(CHROME, ['--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox', '--hide-scrollbars', `--user-data-dir=/tmp/chr-capture-${dbgPort}`, `--remote-debugging-port=${dbgPort}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
async function waitJson() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${dbgPort}/json/list`); const j = await r.json(); if (j.length) return j[0]; } catch (e) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('chrome debug port never came up');
}
const target = await waitJson();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let msgId = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } });
function send(method, params = {}) { return new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
await send('Page.enable'); await send('Runtime.enable');
mkdirSync(outDir, { recursive: true });
for (const shot of shots) {
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?shot=${shot}` });
  await new Promise((r) => setTimeout(r, 2600));
  const status = await evaluate(`document.getElementById('status').textContent`);
  const shotRes = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88, fromSurface: true });
  const buf = Buffer.from(shotRes.data, 'base64');
  writeFileSync(join(outDir, shot + '.jpg'), buf);
  console.log(shot, buf.length, 'B', status ? 'STATUS: ' + status : 'no-error');
}
ws.close(); chrome.kill('SIGKILL'); server.close();
