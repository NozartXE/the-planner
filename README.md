# the-planner

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/NozartXE/the-planner/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/NozartXE/the-planner/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**THE PLANNER** is a top-down 2D open-world crime game set in MERIDIAN, a sun-soaked riverport city. You are the Planner: fixer Mara Voss brings the jobs, and you work both sides of every heist — first on the **planning board**, then live in the streets of the Meridian Mile.

**Plan it.** For each of the 8 campaign heists (casino vault, bank, jewelry exchange, museum gem, port container, data centre, armored-truck ambush, racetrack strongroom) you choose the entry point (3 per target), up to 3 crew from 6 specialists (each with a skill rating and a cut %), 3 gear items from 10, a getaway car from your garage, and a time of day. The board draws the district map with your escape route and live stats — LOOT estimate, ALARM delay, HEAT forecast, ESCAPE window — and every choice mechanically changes the job: patrol density, alarm length, loot grab rate, camera coverage, getaway spawn and police response delay.

**Drive it.** Execute in a dense district of ~40 signed buildings, named streets, ambient traffic that follows the road graph, and pedestrians who flee danger. Six car classes with distinct speed/handling/durability, damage and smoke, handbrake drifts with skid marks, stealable parked cars. On foot you get mouse-aim pistol combat, crew commands (follow / wait / grab — watch the loot bags), and four gadgets on the number keys: CUT POWER, JAM, DECOY and SPIKES.

**Escape it.** The wanted system runs 1–5 stars: pursuit steering with PIT nudges, roadblocks, spike strips, and a helicopter searchlight from 3 stars. Heat decays when you're unseen; garages (Murphy's Body Shop, Turbo Wash) and bribe fixers shed it faster. Get surrounded at low speed and the bust meter fills. Results settle the fence fee and crew cuts, award a grade (S/A/B/C) and REP, and unlock the next job.

**Free roam** between jobs: street-race checkpoint runs against a par time, taxi fares, and chop-shop deliveries. Progress, cash, REP, garage and best grades persist in `localStorage`. The simulation is deterministic (seeded RNG, fixed 1/60 timestep), the audio is a generated WebAudio synth, and the whole game is plain ES modules with zero dependencies and zero network requests.

## Run it

```sh
node serve.ts
```

then open http://localhost:8080

Controls: WASD/arrows move & drive · E enter/exit car · mouse aim, click fire · Shift run / handbrake · 1–4 gadgets · C crew orders · B planning board · P pause · H help.

<sub>Entered on [make.fun](https://make.fun/?ref=hr2ehgtj&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
