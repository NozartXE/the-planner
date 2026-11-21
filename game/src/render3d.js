// render3d.js — TOTAL REBUILD Phase 1: the renderer CORE for AMBER COAST.
// Written from scratch for the renderer-class move (2026-11-21): a real
// per-pixel pipeline — THREE.WebGLRenderer with ACESFilmic tone mapping,
// sRGB output, PCFSoft shadow mapping, and a PMREM environment generated
// from a procedural gradient sky so MeshStandardMaterial paint / glass /
// chrome actually reflect the time of day. This module also owns the
// shared batching kit (Batch + geometry push helpers + colour utilities)
// that vehicles3d / figures3d / view3d build on, and the time-of-day
// GRADES contract the old view3d.js exposed (golden / dusk values are the
// standing ones; day / night carry the Phase 3 range) — same keys, same
// fields, wider light range, now driving a physical light rig.
//
// Deterministic by construction: no Math.random / Date.now anywhere —
// every variation is a seeded hash of world data, so frozen screenshot
// staging stays byte-identical across runs.
import * as THREE from '../vendor/three.module.min.js';

// ------------------------------------------------------------ colour utils
export function norm3(x, y, z) { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; }
export function hash01(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
const rgbCache = new Map();
export function rgb(hex) {
  let c = rgbCache.get(hex);
  if (!c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    c = m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : [200, 200, 200];
    rgbCache.set(hex, c);
  }
  return c;
}
export function parseColor(str, fallback) {
  if (!str) return fallback;
  if (str[0] === '#') return rgb(str);
  const m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str);
  return m ? [+m[1], +m[2], +m[3]] : fallback;
}
// sRGB triple (0..255) → linear-space triple (0..1): materials and vertex
// colours are authored in sRGB and converted on the way in, so the
// established palette survives the move to a linear pipeline.
const _tc = new THREE.Color();
export function lin(triple) {
  _tc.setRGB(triple[0] / 255, triple[1] / 255, triple[2] / 255, THREE.SRGBToLinearColorSpace);
  return [_tc.r, _tc.g, _tc.b];
}
export function linColor(triple) { return new THREE.Color().setRGB(triple[0] / 255, triple[1] / 255, triple[2] / 255, THREE.SRGBToLinearColorSpace); }
export function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ------------------------------------------------------------- time grades
// The plan's time choice made visible. GOLDEN is the game's established
// sunset and DUSK its deeper sibling (standing values, untouched); DAY
// and NIGHT extend the range: bright neutral midday under a high sun,
// and a deep-blue night under a low eastern moon where the emissive
// windows and streetlights carry the frame. fogNear/fogFar and an
// optional per-grade sunDir ride on the grade.
const SUNSET_TOP = [88, 102, 130];
const SUNSET_MID = [186, 124, 122];
const SUNSET_HOR = [252, 184, 124];
const FOG = [214, 184, 166];
const SUN = [255, 196, 116];
export const GRADES = {
  golden: { top: SUNSET_TOP, mid: SUNSET_MID, hor: SUNSET_HOR, fog: FOG, sun: SUN, light: 1.0, wash: 1.0, emissive: 0.38, fogNear: 240, fogFar: 1550 },
  dusk: { top: [38, 26, 64], mid: [120, 52, 92], hor: [214, 102, 84], fog: [150, 88, 96], sun: [240, 150, 90], light: 0.72, wash: 1.6, emissive: 0.85, fogNear: 190, fogFar: 1250 },
  day: { top: [97, 141, 190], mid: [154, 183, 208], hor: [219, 228, 224], fog: [200, 215, 224], sun: [255, 246, 228], light: 1.16, wash: 0.35, emissive: 0.10, fogNear: 300, fogFar: 1750, sunDir: norm3(-0.42, -0.26, 0.87) },
  night: { top: [9, 15, 37], mid: [23, 33, 66], hor: [54, 64, 98], fog: [24, 32, 52], sun: [170, 190, 232], light: 0.34, wash: 0.45, emissive: 1.15, fogNear: 150, fogFar: 1000, sunDir: norm3(0.52, 0.30, 0.30) },
};
// Sun low in the WEST (world -x), slightly north: shadows stretch EAST.
// (World-space direction TOWARD the sun, z up.)
export const SUN_DIR = norm3(-0.90, -0.24, 0.34);

// ------------------------------------------------------------ WebGL probing
export function probeWebGL() {
  try {
    if (typeof document === 'undefined' || !document.createElement) return false;
    const cv = document.createElement('canvas');
    if (!cv || !cv.getContext) return false;
    const gl = cv.getContext('webgl2') || cv.getContext('webgl');
    if (!gl || typeof gl.getParameter !== 'function') return false;
    return typeof gl.getParameter(gl.VERSION) === 'string';
  } catch (e) { return false; }
}
export function makeCanvas2d(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')];
}

// ------------------------------------------------------------ geometry kit
// The world is rebuilt per frame into a handful of merged meshes (one per
// material). Batch accumulates transformed geometry with per-vertex
// colours; in ID mode every vertex is recoloured by the category of the
// object currently being built (the scale-measurement render).
export const idState = { mode: false, cat: null };
const ID_COLORS = { fig: [0, 1, 0], car: [0, 0, 1], tank: [1, 0, 0], plane: [1, 0, 1] };
export class Batch {
  constructor(withUv = false, rgba = false) {
    this.pos = []; this.nor = []; this.col = []; this.uv = withUv ? [] : null; this.rgba = rgba;
  }
  push(geom, matrix, color, uvMul, uvOff) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    let col = color;
    if (idState.mode) { const idc = ID_COLORS[idState.cat]; col = idc ? [idc[0], idc[1], idc[2], color[3]] : [0, 0, 0, color[3]]; }
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      nv.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nor.push(nv.x, nv.y, nv.z);
      this.col.push(col[0], col[1], col[2]);
      if (this.rgba) this.col.push(col.length > 3 ? col[3] : 1);
      if (this.uv) {
        const uu = u ? u.getX(i) : 0, vv = u ? u.getY(i) : 0;
        this.uv.push(uvMul ? uu * uvMul[0] + (uvOff ? uvOff[0] : 0) : uu, uvMul ? vv * uvMul[1] + (uvOff ? uvOff[1] : 0) : vv);
      }
    }
    if (g !== geom) g.dispose();
  }
  // One quad from four world corners (x, y, z-up), counter-clockwise seen
  // from the lit side; uv = [u0, v0, u1, v1] mapped corner-wise p0..p3.
  quad(p0, p1, p2, p3, color, uv) {
    const a = new THREE.Vector3(p0[0], p0[2], p0[1]), b = new THREE.Vector3(p1[0], p1[2], p1[1]);
    const c = new THREE.Vector3(p2[0], p2[2], p2[1]), d = new THREE.Vector3(p3[0], p3[2], p3[1]);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    let col = color;
    if (idState.mode) { const idc = ID_COLORS[idState.cat]; col = idc ? [idc[0], idc[1], idc[2], color[3]] : [0, 0, 0, color[3]]; }
    const pts = [a, b, c, a, c, d];
    const uvs = uv ? [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]] : null;
    for (let i = 0; i < 6; i++) {
      this.pos.push(pts[i].x, pts[i].y, pts[i].z);
      this.nor.push(n.x, n.y, n.z);
      this.col.push(col[0], col[1], col[2]);
      if (this.rgba) this.col.push(col.length > 3 ? col[3] : 1);
      if (this.uv) this.uv.push(uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0);
    }
  }
  build(mat, shadows = true) {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, this.rgba ? 4 : 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const m = new THREE.Mesh(g, mat);
    if (shadows) { m.castShadow = true; m.receiveShadow = true; }
    return m;
  }
}
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
// Matrix in THREE space (x = world x, y = up, z = world y).
export function mat4(px, py, pz, rotY = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(0, rotY, 0); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), _q.clone(), new THREE.Vector3(sx, sy, sz));
}
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
// Axis-aligned-in-yaw box from world centre + half extents (x, y, z-up).
export function box(batch, cx, cy, cz, hx, hy, hz, yaw, color, uvMul, uvOff) {
  batch.push(UNIT_BOX, mat4(cx, cz, cy, -yaw, hx * 2, hz * 2, hy * 2), color, uvMul, uvOff);
}
// Tapered segment between two world points (trunks, barrels, props):
// a round-section cylinder, smooth-shaded, radius r0 at p0 → r1 at p1.
export function limb(batch, p0, p1, r0, r1, color, segs = 7, squash = 1) {
  const a = new THREE.Vector3(p0[0], p0[2], p0[1]), b = new THREE.Vector3(p1[0], p1[2], p1[1]);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length() || 0.001;
  const g = new THREE.CylinderGeometry(r1, r0, len, segs);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const m = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, squash));
  batch.push(g, m, color);
  g.dispose();
}
// Capsule segment between two world points (figure limbs): a true
// capsule — cylinder with hemispherical caps — smooth-shaded, so joints
// read as flesh/cloth volumes instead of tubes with ball patches. The
// capsule's total span is |p1-p0| + 2r along the segment axis; callers
// pass joint centres, so the caps round OVER the joints.
export function capsule(batch, p0, p1, r, color, segs = 10) {
  const a = new THREE.Vector3(p0[0], p0[2], p0[1]), b = new THREE.Vector3(p1[0], p1[2], p1[1]);
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.05, dir.length() - r * 0.6);
  const g = new THREE.CapsuleGeometry(r, len, 3, segs);
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const m = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1));
  batch.push(g, m, color);
  g.dispose();
}
export function ball(batch, x, y, z, r, color, detail = 1) {
  const g = new THREE.SphereGeometry(r, detail ? 14 : 10, detail ? 10 : 8);
  batch.push(g, mat4(x, z, y, 0, 1, 1, 1), color);
  g.dispose();
}
// Ellipsoid at a world point (figure torso/head volumes): a unit sphere
// scaled to radii (rx along facing, ry lateral, rz up) under a yaw.
export function ellipsoid(batch, x, y, z, rx, ry, rz, yaw, color) {
  const g = new THREE.SphereGeometry(1, 16, 12);
  batch.push(g, mat4(x, z, y, -yaw, rx, rz, ry), color);
  g.dispose();
}
export function disc(batch, x, y, z, r, color, seg = 20) {
  const g = new THREE.CircleGeometry(r, seg);
  batch.push(g, mat4(x, z, y, 0).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)), color);
  g.dispose();
}
// Trapezoid prism geometry in CAR-LOCAL space (x forward, y up, z
// lateral): a box whose top face slopes from rRear (fraction of height
// at x −0.5) to rFront (at x +0.5), flat-shaded with computed normals.
export function prismGeo(rRear, rFront) {
  const RBL = [-0.5, 0, -0.5], RBR = [-0.5, 0, 0.5], RTL = [-0.5, rRear, -0.5], RTR = [-0.5, rRear, 0.5];
  const FBL = [0.5, 0, -0.5], FBR = [0.5, 0, 0.5], FTL = [0.5, rFront, -0.5], FTR = [0.5, rFront, 0.5];
  const tris = [
    RTL, RTR, FTR, RTL, FTR, FTL,
    RBL, FBR, RBR, RBL, FBL, FBR,
    RBL, FTL, FBL, RBL, RTL, FTL,
    RBR, FBR, FTR, RBR, FTR, RTR,
    RBL, RBR, RTR, RBL, RTR, RTL,
    FBL, FTL, FTR, FBL, FTR, FBR,
  ];
  const pos = [];
  for (const v of tris) pos.push(v[0], v[1], v[2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
export function prism(batch, M, cx, zBase, len, wid, hRear, hFront, color) {
  const hMax = Math.max(hRear, hFront, 0.01);
  const g = prismGeo(hRear / hMax, hFront / hMax);
  batch.push(g, M.clone().multiply(mat4(cx, zBase, 0, 0, len, hMax, wid)), color);
  g.dispose();
}

// ------------------------------------------------------------- renderer core
// The gradient sky shader (fog-exempt dome). The SAME shader feeds the
// PMREM environment: a miniature scene holding only the dome is rendered
// through PMREMGenerator once per grade, so paint and glass reflect the
// grade's actual sky — warm horizon at golden, deep blue at night.
function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: linColor(SUNSET_TOP) }, mid: { value: linColor(SUNSET_MID) }, hor: { value: linColor(SUNSET_HOR) },
      sunDir: { value: new THREE.Vector3(SUN_DIR[0], SUN_DIR[2], SUN_DIR[1]) }, sunCol: { value: linColor(SUN) },
      haze: { value: linColor(FOG) },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 haze;',
      'varying vec3 vDir;',
      'void main(){',
      '  float h = clamp(vDir.y, -0.08, 1.0);',
      '  vec3 col = h > 0.32 ? mix(mid, top, smoothstep(0.32, 0.95, h)) : mix(hor, mid, smoothstep(-0.02, 0.32, h));',
      '  col = mix(haze, col, smoothstep(-0.01, 0.16, h));',
      '  float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);',
      '  col += sunCol * (pow(s, 220.0) * 0.85 + pow(s, 18.0) * 0.30);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
}

export function createCore(VIEW_W, VIEW_H, VFOV) {
  const glCanvas = document.createElement('canvas');
  glCanvas.width = VIEW_W; glCanvas.height = VIEW_H;
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'default' });
  renderer.setSize(VIEW_W, VIEW_H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VFOV, VIEW_W / VIEW_H, 1, 4200);

  const skyMat = skyMaterial();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3400, 24, 12), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // Lighting rig: a hemisphere fill (sky/ground bounce) plus the key
  // directional sun/moon with a fitted shadow frustum. Intensities are
  // set per grade in applyGrade — Standard materials in a linear pipeline
  // want a stronger key than the old Lambert rig used.
  const hemi = new THREE.HemisphereLight(linColor([255, 196, 150]), linColor([84, 66, 54]), 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(linColor(SUN), 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 2400;
  sun.shadow.camera.left = -420; sun.shadow.camera.right = 420;
  sun.shadow.camera.top = 420; sun.shadow.camera.bottom = -420;
  sun.shadow.bias = -0.0006;
  scene.add(sun); scene.add(sun.target);
  scene.fog = new THREE.Fog(linColor(FOG), 240, 1550);

  // PMREM environment, cached per grade: reflections follow the sky.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), skyMat);
  envScene.add(envSky);
  const envCache = new Map();
  let envGrade = null;
  function refreshEnv(gradeName, grade, sDir) {
    if (envGrade === gradeName && envCache.has(gradeName)) { scene.environment = envCache.get(gradeName); return; }
    skyMat.uniforms.top.value.copy(linColor(grade.top));
    skyMat.uniforms.mid.value.copy(linColor(grade.mid));
    skyMat.uniforms.hor.value.copy(linColor(grade.hor));
    skyMat.uniforms.sunCol.value.copy(linColor(grade.sun));
    skyMat.uniforms.sunDir.value.set(sDir[0], sDir[2], sDir[1]);
    skyMat.uniforms.haze.value.copy(linColor(grade.fog));
    const rt = pmrem.fromScene(envScene, 0.04);
    envCache.set(gradeName, rt.texture);
    scene.environment = rt.texture;
    envGrade = gradeName;
  }

  return {
    renderer, scene, camera, glCanvas, skyMat, sky, hemi, sun,
    dyn: [], sprites: [],
    // Per-frame grade application: fog, sky uniforms, env reflections,
    // rig intensities and the sun's shadow-fitted placement all follow
    // game.timeGrade. anchor = the world point the shadow frustum and
    // sun target centre on (the camera's subject).
    applyGrade(gradeName, grade, anchor) {
      const sDir = grade.sunDir || SUN_DIR;
      scene.fog.color.copy(linColor(grade.fog));
      scene.fog.near = grade.fogNear;
      scene.fog.far = grade.fogFar;
      refreshEnv(gradeName, grade, sDir);
      hemi.intensity = 0.45 * grade.light;
      hemi.color.copy(linColor(grade.sun).lerp(linColor([255, 255, 255]), 0.35));
      sun.intensity = 1.5 * grade.light;
      sun.color.copy(linColor(grade.sun));
      sun.position.set(anchor.x + sDir[0] * 950, sDir[2] * 950, anchor.y + sDir[1] * 950);
      sun.target.position.set(anchor.x, 0, anchor.y);
      sun.target.updateMatrixWorld();
      sky.position.copy(camera.position);
    },
    // ID render (scale measurement): pure flat colours must survive to
    // the readback thresholds, so tone mapping is bypassed in ID mode.
    setIDMode(on) {
      idState.mode = on;
      renderer.toneMapping = on ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    },
  };
}
