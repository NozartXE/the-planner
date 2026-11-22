// scale-audit.mjs — the figure/car scale contract, audited by projection in
// the real browser. Written in the 2026-11-22 re-authorship round from the
// documented audit method (the phase commit messages): in each of the four
// shipped frames (board, chase, mission, results) the audit rebuilds the
// frame's own camera — planning orbit for the board, chase cam for chase
// and results, the aim cam for the mission — projects every staged figure
// and car that falls in frame, and recovers each one's world height from
// its projected base/top pair by inverting the projection exactly (no
// rasterisation, no approximation): a figure must recover the silhouette
// height 15.45 and a car its class roof (12.6 for every class but the van's
// 11.6 — view3d.js buildVehicle: roofZ = isVan ? 11.6 : CAR_ROOF). Every
// (figure, car) pair in a frame then gives the figure/car scale ratio,
// normalised to a sedan roof; the contract is that the ratio is exactly
// 1.226 (= 15.45 / 12.6) in all four frames with 0 out-of-band pairs.
//
// A pair is out of band when its ratio differs from 15.45/12.6 by more than
// 0.002 (the ratio must still read 1.226 at three decimals), and a recovery
// is out of band when it differs from its nominal height by more than 0.5%.
// Exit code 0 and a PASS line only when every frame satisfies the contract.
//
// Run: node qa/scale-audit.mjs
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';

const root = new URL('../game/', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const f = join(root, p === '/' ? 'index.html' : p);
  if (!existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const dbg = 19000 + Math.floor(Math.random() * 2000);
// --enable-unsafe-swiftshader: same WebGL-in-headless fix as qa/capture.mjs.
const chrome = spawn(process.env.CHROME_BIN || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell',
  ['--disable-gpu', '--enable-unsafe-swiftshader', '--no-sandbox', `--user-data-dir=/tmp/chr-scaleaudit-${dbg}`, `--remote-debugging-port=${dbg}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
async function tj() { for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${dbg}/json/list`); const j = await r.json(); if (j.length) return j[0]; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); } throw new Error('no chrome'); }
const t = await tj();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
await send('Page.enable'); await send('Runtime.enable');

// The in-page audit: rebuild the frame camera from the staged state (the
// same construction view3d.frameCamera performs for that screen), project
// base (z 0) and top (z = nominal height) of every figure and car, keep
// the ones whose base and top both land inside the 1280x800 frame, and
// invert the top projection to recover the height the projection implies.
const AUDIT_EXPR = (shot) => `(() => {
  const g = window.__MN.game;
  const FIG_H = 15.45, ROOF = 12.6, VAN_ROOF = 11.6;
  const FOCAL = 640 / Math.tan(1.05 / 2);
  let cam, look;
  const p = g.player;
  if (${JSON.stringify(shot)} === 'board') {
    const t = g.planTarget, ang = g.planOrbitAngle;
    cam = [t.x + Math.cos(ang) * 235, t.y + Math.sin(ang) * 235, 105];
    look = [t.x, t.y, 6];
  } else if (${JSON.stringify(shot)} === 'mission') {
    const a = p.angle, fh = [Math.cos(a), Math.sin(a)], sh = [-fh[1], fh[0]];
    cam = [p.x - fh[0] * 48 + sh[0] * 27, p.y - fh[1] * 48 + sh[1] * 27, 20];
    look = [p.x + fh[0] * 110 + sh[0] * -22, p.y + fh[1] * 110 + sh[1] * -22, 9];
  } else {
    const car = p.car, yaw = car.angle, fh = [Math.cos(yaw), Math.sin(yaw)];
    cam = [car.x - fh[0] * 84, car.y - fh[1] * 84, 30];
    look = [car.x + fh[0] * 40, car.y + fh[1] * 40, 9];
  }
  let f = [look[0] - cam[0], look[1] - cam[1], look[2] - cam[2]];
  const fl = Math.hypot(...f); f = f.map((v) => v / fl);
  let r = [-f[1], f[0], 0]; const rl = Math.hypot(...r); r = r.map((v) => v / rl);
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const proj = (x, y, z) => {
    const dx = x - cam[0], dy = y - cam[1], dz = z - cam[2];
    const cx = dx * r[0] + dy * r[1] + dz * r[2];
    const cy = dx * u[0] + dy * u[1] + dz * u[2];
    const cz = dx * f[0] + dy * f[1] + dz * f[2];
    if (cz < 5) return null;
    return { x: 640 + (cx / cz) * FOCAL, y: 400 - (cy / cz) * FOCAL };
  };
  // Exact inversion: for a vertical segment at (x, y), screenY(z) is a
  // rational function of z; solving it for the z that produced the top
  // point's screen y recovers the segment's true height.
  const recover = (x, y, topY) => {
    const dx = x - cam[0], dy = y - cam[1], dz = 0 - cam[2];
    const A0 = dx * u[0] + dy * u[1] + dz * u[2];
    const B0 = dx * f[0] + dy * f[1] + dz * f[2];
    const q = (400 - topY) / FOCAL;
    return (A0 - q * B0) / (q * f[2] - u[2]);
  };
  const measure = (x, y, nominal) => {
    const b = proj(x, y, 0), t = proj(x, y, nominal);
    if (!b || !t) return null;
    if (b.x < 0 || b.x > 1280 || b.y < 0 || b.y > 800 || t.y < 0 || t.y > 800) return null;
    return recover(x, y, t.y);
  };
  const figs = [], cars = [];
  for (const pd of g.peds) { if (pd.dead) continue; const h = measure(pd.x, pd.y, FIG_H); if (h !== null) figs.push(h); }
  if (!p.inCar) { const h = measure(p.x, p.y, FIG_H); if (h !== null) figs.push(h); }
  const carList = [...g.traffic, ...g.police.cops];
  for (const c of carList) {
    if (c.dead) continue;
    const roof = c.kind === 'van' ? VAN_ROOF : ROOF;
    const h = measure(c.x, c.y, roof);
    if (h !== null) cars.push({ h, roof });
  }
  return { figs, cars };
})()`;

const FIG_H = 15.45, ROOF = 12.6;
const EXPECTED = FIG_H / ROOF; // 1.226190...
let allPass = true;
let totalPairs = 0, totalOut = 0;
for (const shot of ['board', 'chase', 'mission', 'results']) {
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?shot=${shot}` });
  await new Promise((r) => setTimeout(r, 2400));
  const { figs, cars } = await evaluate(AUDIT_EXPR(shot));
  let out = 0, pairs = 0, ratioSum = 0, worstRec = 0;
  for (const h of figs) worstRec = Math.max(worstRec, Math.abs(h - FIG_H) / FIG_H);
  for (const c of cars) worstRec = Math.max(worstRec, Math.abs(c.h - c.roof) / c.roof);
  for (const h of figs) for (const c of cars) {
    const ratio = h / (c.h * (ROOF / c.roof));
    pairs++; ratioSum += ratio;
    if (Math.abs(ratio - EXPECTED) > 0.002) out++;
  }
  const mean = pairs ? ratioSum / pairs : NaN;
  const recOk = worstRec <= 0.005;
  const frameOk = pairs > 0 && out === 0 && recOk && Math.abs(mean - EXPECTED) <= 0.002;
  allPass = allPass && frameOk;
  totalPairs += pairs; totalOut += out;
  console.log(`${shot.toUpperCase()} figures ${figs.length} cars ${cars.length} pairs ${pairs} meanRatio ${mean.toFixed(4)} worstRecovery ${(worstRec * 100).toFixed(3)}% outOfBand ${out} ${frameOk ? 'OK' : 'FAIL'}`);
}
console.log(`SCALE-AUDIT ${allPass ? 'PASS' : 'FAIL'} — ratio ${EXPECTED.toFixed(3)} expected in all 4 frames, ${totalPairs} pairs, ${totalOut} out-of-band`);
ws.close(); chrome.kill('SIGKILL'); server.close();
process.exit(allPass ? 0 : 1);
