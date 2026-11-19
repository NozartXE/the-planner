// measure.mjs — hard acceptance checks in the real browser:
//  (a) figure-vs-car pixel ratios from the ?shot=scale ID render
//  (b) chase: live cops whose projected centre+extent fall fully in frame
//  (c) per-shot blank-region estimate (32x20 grid, low-variance cells)
//  (d) 320px thumbnails written to qa/thumb-*.jpg
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
const root = new URL('../game/', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => { const p = new URL(req.url, 'http://x').pathname; const f = join(root, p === '/' ? 'index.html' : p); if (!existsSync(f)) { res.writeHead(404).end(); return; } res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(readFileSync(f)); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const dbg = 19000 + Math.floor(Math.random() * 2000);
const chrome = spawn(process.env.CHROME_BIN || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell', ['--disable-gpu', '--no-sandbox', `--user-data-dir=/tmp/chr-measure-${dbg}`, `--remote-debugging-port=${dbg}`, '--window-size=1280,800', 'about:blank'], { stdio: 'ignore' });
async function tj() { for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${dbg}/json/list`); const j = await r.json(); if (j.length) return j[0]; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); } throw new Error('no chrome'); }
const t = await tj();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
async function load(shot) { await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?shot=${shot}` }); await new Promise((r) => setTimeout(r, 2400)); }

// (a) scale
await load('scale');
const scale = await evaluate(`(() => {
  const g = window.__MN.game; g.idRender = true;
  window.__MN.render(document.getElementById('game').getContext('2d'), g);
  const cv = document.getElementById('game'); const cx = cv.getContext('2d');
  const d = cx.getImageData(0, 0, cv.width, cv.height).data;
  const box = { fig: null, car: null };
  const cnt = { fig: 0, car: 0 };
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const i = (y * cv.width + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
    const k = (gg > 200 && r < 60 && b < 60) ? 'fig' : (b > 200 && r < 60 && gg < 60) ? 'car' : null;
    if (!k) continue; cnt[k]++;
    if (!box[k]) box[k] = { x0: x, x1: x, y0: y, y1: y };
    const B = box[k]; B.x0 = Math.min(B.x0, x); B.x1 = Math.max(B.x1, x); B.y0 = Math.min(B.y0, y); B.y1 = Math.max(B.y1, y);
  }
  const fh = box.fig.y1 - box.fig.y0 + 1, ch = box.car.y1 - box.car.y0 + 1;
  return { figH: fh, carH: ch, hRatio: +(fh / ch).toFixed(3), figArea: cnt.fig, carArea: cnt.car, aRatio: +(cnt.fig / cnt.car).toFixed(3) };
})()`);
console.log('SCALE', JSON.stringify(scale));

// (b) chase cops in frame + (c) blank estimate per shot
for (const shot of ['board', 'chase', 'mission', 'results']) {
  await load(shot);
  const m = await evaluate(`(() => {
    const g = window.__MN.game; const P = window.__MN.project;
    let cops = null;
    if (${JSON.stringify(shot)} === 'chase') {
      // Rebuild the renderer's own camera basis (projectPoint needs a live
      // frame, which is torn down after each render): hero chase cam, 84
      // behind / 30 up, looking 40 ahead at z 9, focal from FOV 1.05.
      const hero = g.player.car, yaw = hero.angle;
      const fh = [Math.cos(yaw), Math.sin(yaw)];
      const cam = [hero.x - fh[0] * 84, hero.y - fh[1] * 84, 30];
      const look = [hero.x + fh[0] * 40, hero.y + fh[1] * 40, 9];
      let f = [look[0] - cam[0], look[1] - cam[1], look[2] - cam[2]];
      const fl = Math.hypot(f[0], f[1], f[2]); f = f.map((v) => v / fl);
      let r = [-f[1], f[0], 0]; const rl = Math.hypot(r[0], r[1], r[2]); r = r.map((v) => v / rl);
      const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
      const FOCAL = 640 / Math.tan(1.05 / 2);
      const proj = (x, y, z) => {
        const dx = x - cam[0], dy = y - cam[1], dz = z - cam[2];
        const cxp = dx * r[0] + dy * r[1] + dz * r[2], cyp = dx * u[0] + dy * u[1] + dz * u[2], czp = dx * f[0] + dy * f[1] + dz * f[2];
        if (czp < 5) return null;
        return { x: 640 + (cxp / czp) * FOCAL, y: 400 - (cyp / czp) * FOCAL };
      };
      cops = g.police.cops.filter((c) => !c.dead).map((c) => {
        const pts = [];
        for (const sgn of [1, -1]) for (const lat of [10, -10]) pts.push(proj(c.x + Math.cos(c.angle) * 21 * sgn - Math.sin(c.angle) * lat, c.y + Math.sin(c.angle) * 21 * sgn + Math.cos(c.angle) * lat, 6));
        const ok = pts.every((p) => p && p.x > 4 && p.x < 1276 && p.y > 4 && p.y < 796);
        const ctr = proj(c.x, c.y, 6);
        return { in: ok, x: ctr ? Math.round(ctr.x) : -1, y: ctr ? Math.round(ctr.y) : -1 };
      });
    }
    const cv = document.getElementById('game'); const cx2 = cv.getContext('2d');
    const d = cx2.getImageData(0, 0, cv.width, cv.height).data;
    const GW = 32, GH = 20, cw = cv.width / GW, chh = cv.height / GH;
    let blankCells = 0; const blankGrid = [];
    for (let gy = 0; gy < GH; gy++) { blankGrid.push([]); for (let gx = 0; gx < GW; gx++) {
      let mean = 0, n = 0; const vals = [];
      for (let y = Math.floor(gy * chh); y < (gy + 1) * chh; y += 4) for (let x = Math.floor(gx * cw); x < (gx + 1) * cw; x += 4) { const i = (y * cv.width + x) * 4; const v = (d[i] + d[i + 1] + d[i + 2]) / 3; vals.push(v); mean += v; n++; }
      mean /= n; let sd = 0; for (const v of vals) sd += (v - mean) * (v - mean); sd = Math.sqrt(sd / n);
      const blank = sd < 4.5; blankGrid[gy].push(blank); if (blank) blankCells++;
    } }
    // largest connected blank run (4-connected flood fill)
    let best = 0; const seen = new Set();
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      if (!blankGrid[gy][gx] || seen.has(gx + ',' + gy)) continue;
      let size = 0; const st = [[gx, gy]];
      while (st.length) { const [x, y] = st.pop(); const k = x + ',' + y; if (seen.has(k) || !blankGrid[y] || !blankGrid[y][x]) continue; seen.add(k); size++; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
      best = Math.max(best, size);
    }
    // Largest single flat-colour cluster (channels quantised to 24 steps):
    // one unbroken surface at one shade — the "blank surface" the judges mean.
    const clusters = new Map();
    for (let y = 0; y < cv.height; y += 3) for (let x = 0; x < cv.width; x += 3) {
      const i = (y * cv.width + x) * 4;
      const k = ((d[i] / 24) | 0) * 121 + ((d[i + 1] / 24) | 0) * 11 + ((d[i + 2] / 24) | 0);
      clusters.set(k, (clusters.get(k) || 0) + 1);
    }
    let topCluster = 0, tot = 0;
    for (const v of clusters.values()) { tot += v; topCluster = Math.max(topCluster, v); }
    // Foreground band (bottom 45% of frame): largest flat cluster there —
    // the "empty foreground" share the staging specs cap.
    const fg = new Map(); let fgTot = 0;
    for (let y = Math.floor(cv.height * 0.55); y < cv.height; y += 3) for (let x = 0; x < cv.width; x += 3) {
      const i = (y * cv.width + x) * 4;
      const k = ((d[i] / 24) | 0) * 121 + ((d[i + 1] / 24) | 0) * 11 + ((d[i + 2] / 24) | 0);
      fg.set(k, (fg.get(k) || 0) + 1); fgTot++;
    }
    let fgTop = 0; for (const v of fg.values()) fgTop = Math.max(fgTop, v);
    return { cops, blankPct: +(blankCells / (GW * GH) * 100).toFixed(1), largestBlankPct: +(best / (GW * GH) * 100).toFixed(1), largestFlatClusterPct: +(topCluster / tot * 100).toFixed(1), foregroundFlatPct: +(fgTop / fgTot * 100).toFixed(1) };
  })()`);
  console.log(shot.toUpperCase(), JSON.stringify(m));
  // (d) thumbnail
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 200, deviceScaleFactor: 1, mobile: false });
  await new Promise((r) => setTimeout(r, 700));
  const th = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true });
  writeFileSync(new URL('../qa/thumb-' + shot + '.jpg', import.meta.url).pathname, Buffer.from(th.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride', {});
}
ws.close(); chrome.kill('SIGKILL'); server.close();
