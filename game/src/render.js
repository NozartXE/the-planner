// render.js — camera state for the sim loop + delegation to the 3D chase-cam
// renderer (view3d.js). The play view, title backdrop and summary backdrop are all
// rendered in true-perspective 3D by view3d; this module keeps the legacy camera
// object that main.js updates every tick (its x/y still anchor save-free systems)
// and exposes renderGame under its historical name so every caller gets the 3D view.
import { VIEW_W, VIEW_H, WORLD_SIZE, CAMERA_ZOOM } from './config.js';
import { clamp } from './rng.js';
import { renderView3D } from './view3d.js';

export function makeCamera() { return { x: 1880, y: 1880, zoom: CAMERA_ZOOM }; }
export function updateCamera(cam, target, vx, vy, dt) {
  const lx = target.x + (vx || 0) * 0.42, ly = target.y + (vy || 0) * 0.42;
  const k = Math.min(1, dt * 5.5);
  cam.x += (lx - cam.x) * k; cam.y += (ly - cam.y) * k;
  const hw = VIEW_W / cam.zoom / 2, hh = VIEW_H / cam.zoom / 2;
  cam.x = clamp(cam.x, hw - 120, WORLD_SIZE - hw + 120);
  cam.y = clamp(cam.y, hh - 120, WORLD_SIZE - hh + 120);
}
export function renderGame(ctx, game) { renderView3D(ctx, game); }
