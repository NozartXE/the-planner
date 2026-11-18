// input.js — keyboard + mouse state, sampled by the fixed-step loop.
export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.pressed = new Set();
    this.mouseX = 0; this.mouseY = 0; this.mouseDown = false; this.mousePressed = false;
    this.clickX = 0; this.clickY = 0; this.clicked = false; this.enabled = true;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouseX = (e.clientX - r.left) * (canvas.width / Math.max(1, r.width));
      this.mouseY = (e.clientY - r.top) * (canvas.height / Math.max(1, r.height));
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) { this.mouseDown = true; this.mousePressed = true; } });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      this.clickX = (e.clientX - r.left) * (canvas.width / Math.max(1, r.width));
      this.clickY = (e.clientY - r.top) * (canvas.height / Math.max(1, r.height));
      this.clicked = true;
    });
  }
  down(...names) { return names.some((n) => this.keys.has(n)); }
  wasPressed(...names) { return names.some((n) => this.pressed.has(n)); }
  moveAxis() {
    let x = 0, y = 0;
    if (this.down('a', 'arrowleft')) x -= 1;
    if (this.down('d', 'arrowright')) x += 1;
    if (this.down('w', 'arrowup')) y -= 1;
    if (this.down('s', 'arrowdown')) y += 1;
    if (x !== 0 && y !== 0) { const s = Math.SQRT1_2; x *= s; y *= s; }
    return { x, y };
  }
  endStep() { this.pressed.clear(); this.mousePressed = false; this.clicked = false; }
}
