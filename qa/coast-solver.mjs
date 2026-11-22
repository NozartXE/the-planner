// coast-solver.mjs — projection solver for the standing open defect: a coast
// (Ocean Drive) title framing. Authored in the 2026-11-22 re-authorship round
// as the tooling behind that round's coast attempt; kept in qa/ so the next
// attempt starts from the measurement, not from memory.
//
// Method. The title's world pass uses the planning-orbit camera (235 units
// out, 105 up, looking at planTarget, z 6) with the renderer's own focal
// length (view3d.js: FOV 1.05, FOCAL = 640 / tan(FOV/2) at 1280x800). For
// every candidate planTarget on Ocean Drive (x 3714) in both look
// directions, this solver projects the real blockers from the generated
// city — building boxes, tree/palm canopies on the corridor's median and
// sidewalk lines, zebra bands at the cross streets — into the frame and
// tests them against the title overlay's text bands (hud.js drawTitle:
// AMBER baseline 238 and COAST 302 at 58px, tagline 344, controls 402/428,
// ENTER 486, save line 524). A framing passes only if the hero + figure can
// stand in the foreground clear of every building footprint, the camera
// itself stands in open air, no corridor facade fills the logotype centre
// or crosses a text band, and no canopy or zebra band crosses a text band.
//
// Standing result (2026-11-22, this solver + a real capture of the
// least-blocked candidate): 0 of 1,266 candidates pass. The drive's east-
// plot buildings stand across the road itself (11 facades, x 3582-3749
// over the 3668-3760 asphalt), leaving two clear stretches (y 738-1239 and
// y 2337-3119); each holds a cross-street zebra in its mid-frame zone and
// is lined with palms on both sidewalks whose canopies cross the text
// bands at every viable depth. The least-blocked candidate (target
// (3714, 975) looking south) was staged and captured: the zebra of the
// y 848-940 crossing strikes through both controls rows and the save
// line — the same defect class that disqualified the Phase 4 avenue
// framing — so the avenue title stands. Full record:
// qa/verification-2026-11-22.md.
//
// Run: node qa/coast-solver.mjs   (no arguments; builds the city in-process)
const grad = { addColorStop() {} };
function makeCtx() {
  return new Proxy({
    canvas: null, fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
    lineWidth: 1, globalAlpha: 1, shadowBlur: 0, shadowColor: '',
    measureText: (t) => ({ width: String(t).length * 7 }),
    createLinearGradient: () => grad, createRadialGradient: () => grad,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
  }, { get(t, k) { if (k in t) return t[k]; return () => {}; }, set(t, k, v) { t[k] = v; return true; } });
}
function makeCanvas() { return { width: 376, height: 376, getContext: () => makeCtx(), style: {} }; }
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.document = { getElementById: (id) => (id === 'game' ? makeCanvas() : { textContent: '', className: '' }), createElement: () => makeCanvas() };
globalThis.location = { search: '' };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
delete globalThis.requestAnimationFrame;

const main = await import(new URL('../game/src/main.js', import.meta.url));
const city = main.createGame().city;

const FOCAL = 640 / Math.tan(1.05 / 2);
const DRIVE_X = 3714;           // Ocean Drive centre (results staging + fix-round record)
const ROAD = [3668, 3760];      // drive asphalt: east block edge to the world edge
const TEXT_BANDS = [
  { name: 'AMBER', x0: 440, x1: 840, y0: 197, y1: 238 },
  { name: 'COAST', x0: 440, x1: 840, y0: 261, y1: 302 },
  { name: 'tagline', x0: 230, x1: 1050, y0: 332, y1: 344 },
  { name: 'controls', x0: 300, x1: 980, y0: 391, y1: 428 },
  { name: 'ENTER', x0: 540, x1: 740, y0: 473, y1: 486 },
  { name: 'save', x0: 380, x1: 900, y0: 514, y1: 524 },
];
const LOGO_CENTRE = { x0: 440, x1: 840, y0: 150, y1: 310 };

function makeProj(cam, look) {
  let f = [look[0] - cam[0], look[1] - cam[1], look[2] - cam[2]];
  const fl = Math.hypot(...f); f = f.map((v) => v / fl);
  let r = [-f[1], f[0], 0]; const rl = Math.hypot(...r); r = r.map((v) => v / rl);
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  return (x, y, z) => {
    const dx = x - cam[0], dy = y - cam[1], dz = z - cam[2];
    const cx = dx * r[0] + dy * r[1] + dz * r[2];
    const cy = dx * u[0] + dy * u[1] + dz * u[2];
    const cz = dx * f[0] + dy * f[1] + dz * f[2];
    if (cz < 5) return null;
    return { x: 640 + (cx / cz) * FOCAL, y: 400 - (cy / cz) * FOCAL, d: cz };
  };
}
function boxScreen(P, x0, y0, x1, y1, zTop) {
  let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9, any = false;
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [0, zTop]) {
    const p = P(x, y, z);
    if (!p) continue;
    any = true;
    bx0 = Math.min(bx0, p.x); bx1 = Math.max(bx1, p.x);
    by0 = Math.min(by0, p.y); by1 = Math.max(by1, p.y);
  }
  return any ? { x0: bx0, x1: bx1, y0: by0, y1: by1 } : null;
}
const hit = (a, b) => a && b && a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const covers = (inner, outer) => inner.x0 <= outer.x0 + 40 && inner.x1 >= outer.x1 - 40 && inner.y0 <= outer.y0 + 30 && inner.y1 >= outer.y1 - 30;

// The corridor's building blockers and the drive's clear stretches.
const blockers = city.buildings
  .filter((b) => b.x < ROAD[1] && b.x + b.w > ROAD[0])
  .map((b) => ({ x0: b.x, x1: b.x + b.w, y0: b.y, y1: b.y + b.h, h: b.height }))
  .sort((a, b) => a.y0 - b.y0);
console.log('buildings intersecting the Ocean Drive corridor (x 3668-3760):', blockers.length);
for (const b of blockers) console.log(`  x ${b.x0.toFixed(0)}-${b.x1.toFixed(0)}  y ${b.y0.toFixed(0)}-${b.y1.toFixed(0)}  height ${b.h.toFixed(0)}`);
const clear = [];
let cursor = 0;
for (const b of blockers) { if (b.y0 > cursor) clear.push([cursor, b.y0]); cursor = Math.max(cursor, b.y1); }
if (cursor < 3760) clear.push([cursor, 3760]);
console.log('clear stretches of the drive (no building in corridor):');
for (const [a, b] of clear) console.log(`  y ${a.toFixed(0)}-${b.toFixed(0)}  (${(b - a).toFixed(0)} units)`);
const nearTrees = [...city.trees.map((t) => ({ ...t, kind: 'tree', cz: 12 })), ...city.palms.map((t) => ({ x: t.x, y: t.y, r: 14 * t.s, kind: 'palm', cz: 20 }))]
  .filter((t) => Math.abs(t.x - DRIVE_X) < 190);
console.log('trees/palms within 190 units of the drive centre:', nearTrees.length);

// Zebra bands: the cross-street road bands between block rows (pitch 470, block 378).
const zebras = [];
for (let k = 0; k <= 7; k++) zebras.push([k * 470 + 378, k * 470 + 470]);

function testFraming(ty, dirSign) {
  // dirSign -1: looking north (camera south of target, planOrbitAngle +PI/2)
  // dirSign +1: looking south (camera north of target, planOrbitAngle -PI/2)
  const cam = [DRIVE_X, ty - dirSign * 235, 105];
  const P = makeProj(cam, [DRIVE_X, ty, 6]);
  const fails = [];
  for (const b of city.buildings) {
    if (cam[0] > b.x && cam[0] < b.x + b.w && cam[1] > b.y && cam[1] < b.y + b.h) {
      fails.push(`camera inside building footprint (building y ${b.y.toFixed(0)}-${(b.y + b.h).toFixed(0)}, x ${b.x.toFixed(0)}-${(b.x + b.w).toFixed(0)})`);
    }
  }
  // Hero + figure in the foreground, 135 / 128 units from the camera (the
  // avenue framing's proven distances), standing on the drive.
  const heroY = cam[1] + dirSign * 135;
  const figY = cam[1] + dirSign * 128;
  for (const [label, y, half] of [['hero', heroY, 22], ['figure', figY, 4]]) {
    for (const b of city.buildings) {
      if (DRIVE_X + 20 > b.x && DRIVE_X - 20 < b.x + b.w && y + half > b.y && y - half < b.y + b.h) {
        fails.push(`${label} inside building footprint at y ${y.toFixed(0)} (building y ${b.y.toFixed(0)}-${(b.y + b.h).toFixed(0)}, x ${b.x.toFixed(0)}-${(b.x + b.w).toFixed(0)})`);
      }
    }
    if (y < 60 || y > 3700) fails.push(`${label} off the drive at y ${y.toFixed(0)}`);
  }
  // Corridor facades: buildings standing ON the road axis, projected.
  for (const b of city.buildings) {
    if (!(b.x < ROAD[1] && b.x + b.w > ROAD[0])) continue;
    const along = (b.y + b.h / 2 - cam[1]) * dirSign;
    if (along < -60 || along > 1400) continue;
    const sb = boxScreen(P, b.x, b.y, b.x + b.w, b.y + b.h, b.height);
    if (!sb) continue;
    for (const band of TEXT_BANDS) if (hit(sb, band)) fails.push(`building (y ${b.y.toFixed(0)}-${(b.y + b.h).toFixed(0)}, x ${b.x.toFixed(0)}-${(b.x + b.w).toFixed(0)}, h ${b.height.toFixed(0)}) crosses ${band.name}`);
    if (covers(sb, LOGO_CENTRE)) fails.push(`facade fills the logotype centre (building y ${b.y.toFixed(0)}-${(b.y + b.h).toFixed(0)})`);
  }
  // Canopies on the corridor's own lines (median + both sidewalks).
  for (const t of nearTrees) {
    if (Math.abs(t.x - DRIVE_X) > 75) continue;
    const along = (t.y - cam[1]) * dirSign;
    if (along < 40 || along > 1200) continue;
    const c = P(t.x, t.y, t.cz);
    if (!c) continue;
    const rr = (t.r * FOCAL) / c.d;
    const sb = { x0: c.x - rr, x1: c.x + rr, y0: c.y - rr, y1: c.y + rr };
    for (const band of TEXT_BANDS) if (hit(sb, band)) fails.push(`${t.kind} canopy at (${t.x.toFixed(0)}, ${t.y.toFixed(0)}) crosses ${band.name} (depth ${along.toFixed(0)})`);
  }
  // Zebra bands on the drive.
  for (const [z0, z1] of zebras) {
    const along = ((z0 + z1) / 2 - cam[1]) * dirSign;
    if (along < 60 || along > 1200) continue;
    const sb = boxScreen(P, ROAD[0], z0, ROAD[1], z1, 0.4);
    if (!sb) continue;
    for (const band of TEXT_BANDS) if (hit(sb, band)) fails.push(`zebra band y ${z0}-${z1} crosses ${band.name}`);
  }
  return fails;
}

let passes = 0;
const ranked = [];
for (const dirSign of [-1, 1]) {
  for (let ty = 300; ty <= 3460; ty += 5) {
    const fails = testFraming(ty, dirSign);
    if (!fails.length) { passes++; console.log(`PASS  target y ${ty} looking ${dirSign < 0 ? 'NORTH' : 'SOUTH'}`); }
    ranked.push({ ty, dirSign, n: fails.length, fails });
  }
}
ranked.sort((a, b) => a.n - b.n);
console.log(`\ncandidates passing every test: ${passes} of ${ranked.length}`);
console.log('least-blocked candidates:');
for (const r of ranked.slice(0, 6)) {
  console.log(`  target y ${r.ty} looking ${r.dirSign < 0 ? 'NORTH' : 'SOUTH'} — ${r.n} collisions`);
  for (const f of r.fails.slice(0, 8)) console.log('    -', f);
}
const failSummary = new Map();
for (const r of ranked) for (const f of r.fails) {
  const key = f.replace(/y \d+-\d+/g, 'y …').replace(/\(\d+, \d+\)/g, '(…)').replace(/depth \d+/, 'depth …').replace(/at y \d+/, 'at y …');
  failSummary.set(key, (failSummary.get(key) || 0) + 1);
}
console.log('binding constraints (normalised, by candidate count):');
for (const [k, n] of [...failSummary.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${n}x  ${k}`);
