// story.js — fixer Mara Voss, campaign framing text and result teasers.
export const FIXER = { name: 'MARA VOSS', title: 'FIXER — THE LEDGER' };
export const INTRO_LINES = [
  'MERIDIAN. A riverport that launders money faster than its river moves.',
  'You are THE PLANNER. Mara Voss brings the jobs; you bring the board,',
  'the crew, the route — and the nerve to drive it yourself.',
];
export const NEXT_TEASER = {
  'casino-vault': 'Next: Meridian Trust keeps a bigger vault and worse manners.',
  'bank-vault': 'Next: Velmara trades in small stones with enormous margins.',
  'jewelry-exchange': 'Next: one gem, forty cameras, at the Halcyon Museum.',
  'museum-gem': 'Next: a quiet container at the port, full of loud money.',
  'port-container': 'Next: Novacore guards data like gold. It is gold.',
  'data-centre': 'Next: an armored truck, a shift change, ninety seconds.',
  'armored-ambush': 'Next: derby day. Every cop in the Mile, one strongroom.',
  'racetrack-strongroom': 'The Mile is yours. Free roam, legend.',
};
export const RESULT_QUIPS = {
  S: 'Mara: "Flawless. The board worked because the planner did."',
  A: 'Mara: "Clean enough to frame. Almost."',
  B: 'Mara: "Paid is paid. Tighten the next plan."',
  C: 'Mara: "Messy money still spends. Barely."',
  FAIL: 'Mara: "We do not talk about that night. We re-plan."',
};
export const REP_TITLES = ['NOBODY', 'RUNNER', 'WHEELMAN', 'FIXER\'S FRIEND', 'PLANNER', 'GHOST OF THE MILE', 'MERIDIAN LEGEND'];
export function repTitle(rep) {
  const idx = Math.min(REP_TITLES.length - 1, Math.floor(rep / 120));
  return REP_TITLES[idx];
}
