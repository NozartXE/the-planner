// input.js — keyboard state: a held set plus a pressed-this-frame edge set, with game keys kept from scrolling the page.
const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyP', 'KeyH', 'KeyR', 'KeyG', 'KeyT', 'KeyF', 'ShiftLeft', 'ShiftRight', 'Enter', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']);
export class Input {
  constructor(target) {
    this.down = new Set();
    this.pressed = new Set();
    this.target = target || (typeof window !== 'undefined' ? window : null);
    this._onDown = (ev) => {
      if (GAME_KEYS.has(ev.code)) { try { ev.preventDefault(); } catch (e) {} }
      if (!this.down.has(ev.code)) this.pressed.add(ev.code);
      this.down.add(ev.code);
    };
    this._onUp = (ev) => { this.down.delete(ev.code); };
    if (this.target && this.target.addEventListener) {
      this.target.addEventListener('keydown', this._onDown);
      this.target.addEventListener('keyup', this._onUp);
    }
  }
  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  axisX() { return (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('KeyA') || this.isDown('ArrowLeft') ? 1 : 0); }
  axisY() { return (this.isDown('KeyS') || this.isDown('ArrowDown') ? 1 : 0) - (this.isDown('KeyW') || this.isDown('ArrowUp') ? 1 : 0); }
  setKey(code, isDown) {
    if (isDown) { if (!this.down.has(code)) this.pressed.add(code); this.down.add(code); }
    else this.down.delete(code);
  }
  endFrame() { this.pressed.clear(); }
}
