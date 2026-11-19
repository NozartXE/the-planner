// radio.js — the in-car radio: a real station list with named tracks, cycled
// with the R key. The HUD strip only ever reads this object's current station
// and track, so the readout can never claim a station the game does not have.
export const STATIONS = [
  { name: 'AMBER FM 91.3', tracks: ['Golden Hour Drive', 'Palm Static', 'Coastline Hearts'] },
  { name: 'TIDEWAVE 98.7', tracks: ['Salt on the Wind', 'Neon Marina', 'Low Sun, High Tide'] },
  { name: 'SOLANA NIGHTS 104.1', tracks: ['Deco Dreams', 'Aurelia', 'Last Ferry Home'] },
  { name: 'PALMA TALK 88.0', tracks: ['Harbour Report', 'Venn in the Community', 'Traffic on Ocean Drive'] },
];
export class Radio {
  constructor() { this.stationIdx = 0; this.trackIdx = 0; this.on = true; }
  station() { return STATIONS[this.stationIdx % STATIONS.length]; }
  track() { const s = this.station(); return s.tracks[this.trackIdx % s.tracks.length]; }
  label() { return this.on ? this.station().name + ' — ' + this.track() : 'RADIO OFF'; }
  // R cycles: next track on this station, then the next station, wrapping.
  cycle() {
    this.trackIdx += 1;
    if (this.trackIdx >= this.station().tracks.length) { this.trackIdx = 0; this.stationIdx = (this.stationIdx + 1) % STATIONS.length; }
  }
}
