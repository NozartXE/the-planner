// post3d.js — TOTAL REBUILD Phase 2: the post pass.
// Selective bloom + a subtle vignette, built from core three.js only
// (WebGLRenderTarget + ShaderMaterial — no EffectComposer, no external
// passes). The scene renders once into a half-float HDR target (the
// renderer's tone mapping and output encoding apply only to the
// default framebuffer, so the target holds true linear HDR); a
// bright-pass extracts what is genuinely bright — light bars, neon,
// lamp heads, fire, tracer cores, sun glints off paint — a separable
// gaussian blur (two iterations, half resolution) spreads it, and the
// composite adds it back over the scene, applies the same ACES filmic
// curve the direct pipeline used, and darkens the frame edges with a
// vignette. The frame must glow at its emissives, never wash out:
// the threshold sits above ordinary sunlit surfaces and the bloom
// strength is capped, so only signals bloom.
// AIM-REPAIR retune (2026-11-22): threshold 0.72 → 0.90, strength
// 0.55 → 0.35. The Phase 2 values bloomed the heli spotlight cone and
// every tracer glow into one diffuse mass ~3x too wide, and the
// mission frame's shot read as ending at the target sedan's rear
// corner instead of the reticle (panel §7(b) fail, ~108–186 px).
//
// Fully deterministic: fixed kernels, fixed iteration counts, no
// clocks, no randomness — frozen captures stay byte-identical.
import * as THREE from '../vendor/three.module.min.js';

const QUAD_VS = [
  'varying vec2 vUv;',
  'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
].join('\n');

const BRIGHT_FS = [
  'uniform sampler2D tSrc; uniform float uThreshold; uniform float uKnee;',
  'varying vec2 vUv;',
  'void main(){',
  '  vec3 c = texture2D(tSrc, vUv).rgb;',
  '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
  '  float w = clamp((l - uThreshold + uKnee) / (2.0 * uKnee), 0.0, 1.0);',
  '  w = w * w * (3.0 - 2.0 * w);',
  '  gl_FragColor = vec4(c * w, 1.0);',
  '}',
].join('\n');

const BLUR_FS = [
  'uniform sampler2D tSrc; uniform vec2 uTexel; uniform vec2 uDir;',
  'varying vec2 vUv;',
  'void main(){',
  '  vec3 col = texture2D(tSrc, vUv).rgb * 0.227027;',
  '  col += texture2D(tSrc, vUv + uDir * uTexel * 1.3846153).rgb * 0.3162162;',
  '  col += texture2D(tSrc, vUv - uDir * uTexel * 1.3846153).rgb * 0.3162162;',
  '  col += texture2D(tSrc, vUv + uDir * uTexel * 3.2307692).rgb * 0.0702703;',
  '  col += texture2D(tSrc, vUv - uDir * uTexel * 3.2307692).rgb * 0.0702703;',
  '  gl_FragColor = vec4(col, 1.0);',
  '}',
].join('\n');

// The composite: scene + bloom, then the renderer's own ACES filmic
// curve — Stephen Hill's fit, exactly the constants the vendored
// three.js tonemapping chunk uses (input/output matrices, the RRT+ODT
// rational fit, exposure / 0.6 at exposure 1.0) — so the post pipeline
// keeps the Phase 1 direct pipeline's response curve to the digit,
// then the vignette, then the sRGB output encoding. The encoding must
// happen HERE: a ShaderMaterial quad receives no output-colorspace
// epilogue from the renderer (verified by a four-band probe against
// the direct pipeline: linear in, ACES out matched the direct values
// only before encoding). The scene target itself holds true linear
// HDR — tone mapping and encoding apply only to the default
// framebuffer in this three build, also probe-verified.
const COMPOSITE_FS = [
  'uniform sampler2D tScene; uniform sampler2D tBloom;',
  'uniform float uStrength; uniform float uVignette;',
  'varying vec2 vUv;',
  'vec3 aces(vec3 color){',
  '  const mat3 ACESInputMat = mat3(',
  '    vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383),',
  '    vec3(0.04823, 0.01566, 0.83777));',
  '  const mat3 ACESOutputMat = mat3(',
  '    vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276),',
  '    vec3(-0.07367, -0.00605, 1.07602));',
  '  color *= 1.0 / 0.6;',
  '  color = ACESInputMat * color;',
  '  vec3 a = color * (color + 0.0245786) - 0.000090537;',
  '  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;',
  '  color = ACESOutputMat * (a / b);',
  '  return clamp(color, 0.0, 1.0);',
  '}',
  'vec3 encodeSRGB(vec3 c){',
  '  vec3 lo = c * 12.92;',
  '  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(0.4166667)) - 0.055;',
  '  return mix(lo, hi, step(vec3(0.0031308), c));',
  '}',
  'void main(){',
  '  vec3 col = texture2D(tScene, vUv).rgb;',
  '  col += texture2D(tBloom, vUv).rgb * uStrength;',
  '  col = aces(col);',
  '  vec2 d = (vUv - 0.5) * vec2(1.28, 1.0);',
  '  float vig = smoothstep(0.52, 1.06, length(d));',
  '  col *= 1.0 - vig * uVignette;',
  '  gl_FragColor = vec4(encodeSRGB(col), 1.0);',
  '}',
].join('\n');

export function createPost(renderer, w, h) {
  const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false };
  // 4x MSAA on the scene target: rendering through a target would
  // otherwise lose the direct pipeline's canvas antialiasing.
  const sceneRT = new THREE.WebGLRenderTarget(w, h, { ...rtOpts, samples: 4 });
  const bw = Math.max(2, w >> 1), bh = Math.max(2, h >> 1);
  const brightRT = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  const blurA = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  const blurB = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  quadScene.add(quad);

  const mat = (fs, uniforms) => new THREE.ShaderMaterial({
    vertexShader: QUAD_VS, fragmentShader: fs, uniforms,
    depthTest: false, depthWrite: false,
  });
  const brightMat = mat(BRIGHT_FS, {
    tSrc: { value: sceneRT.texture }, uThreshold: { value: 0.90 }, uKnee: { value: 0.35 },
  });
  const blurMat = mat(BLUR_FS, {
    tSrc: { value: null }, uTexel: { value: new THREE.Vector2(1 / bw, 1 / bh) }, uDir: { value: new THREE.Vector2(1, 0) },
  });
  const compMat = mat(COMPOSITE_FS, {
    tScene: { value: sceneRT.texture }, tBloom: { value: null },
    uStrength: { value: 0.35 }, uVignette: { value: 0.34 },
  });

  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }
  function blurPass(src, dst, dirX) {
    blurMat.uniforms.tSrc.value = src.texture;
    blurMat.uniforms.uDir.value.set(dirX ? 1 : 0, dirX ? 0 : 1);
    pass(blurMat, dst);
  }

  return {
    sceneRT,
    // Render the lit scene through the full chain, ending on the
    // default framebuffer (the renderer's own canvas).
    render(scene, camera) {
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      pass(brightMat, brightRT);
      blurPass(brightRT, blurA, true);
      blurPass(blurA, blurB, false);
      blurPass(blurB, blurA, true);
      blurPass(blurA, blurB, false);
      compMat.uniforms.tBloom.value = blurB.texture;
      quad.material = compMat;
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCam);
    },
  };
}
