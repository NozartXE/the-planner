[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/NozartXE/the-planner/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/NozartXE/the-planner/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# AMBER COAST

**AMBER COAST** is a 3D chase-cam coastal open-world crime game set on a palm-lined shoreline city caught in permanent golden hour. You work for fixer **Dario Venn**: pick up packages at the marina, steal cars, move a reporter under heat, run a two-drop courier route, and lift an armored sedan — while traffic flows, pedestrians walk the sidewalks, and the police answer every star you earn.

**The city.** A seeded 8×8-block grid (3,760×3,760 world units) of roads, sidewalks, parks with trees and palms, and volumetric buildings with lit facades, seen from a low third-person chase camera behind the car or on foot. The east edge is a beachfront: art-deco pastel facades along the Solana avenue, Ocean Drive, a sand strip and open water with anchored boats. Golden hour is the presentation: warm directional light with long shadows off every block, a sunset gradient wash, and warm gloss streaking on the asphalt, finished with a vignette.

**Systems, all live at once:**

- **Traffic AI** — about 26 civilian cars hold right-hand lanes, choose at intersections, and brake for cars and for you on foot; they recycle at distance so the streets never empty.
- **Stealable cars** — five civilian types plus the police interceptor and a marked armored sedan. Press E beside any car to take it; stealing a moving car earns 1 star, a cop car 3.
- **Wanted + police** — 0–5 stars. Cops spawn off-screen (2 per star, up to 8), pick junction turns that close on you, ram you on contact, and give up as heat decays when you stay clean and unseen.
- **Pedestrians** — 64 walkers loop the sidewalks, flee gunfire and speeding cars, and harming one is a crime.
- **Story missions** — Venn's 5-job chain with briefings, yellow pickup / green delivery markers and countdown timers. Finish the chain and it loops at +25% pay.
- **Combat and consequences** — on-foot shooting, vehicle damage and destruction, WASTED and a respawn at St. Sable Hospital that costs 10% of your cash and clears your heat.
- **The arsenal (56 weapons)** — a data-driven table: 10 assault rifles, 10 SMGs, 5 machine guns, 7 shotguns, 8 sniper rifles, 6 rocket launchers and 10 explosives, every one an original fictional name with stats (damage, fire rate, range, spread, magazine, reload) the combat code really spends. Explosives differ in behaviour: frag grenade, remote C4, molotov fire patches, sticky bombs, proximity mines, pipe bombs, tear gas, a distraction flare, timer satchels and a concussion dazzler. The planning board's arsenal picker (J/K) chooses the mission weapon; in play, Q opens the weapon wheel. The VENN 9MM is one table entry — the EXTENDED MAG gear still grows its 12-round magazine to 18.
- **Vehicle variety** — besides five stealable car types: BASTION tanks parked at Fort Sable (enter with E, drive them, traverse the turret, fire the cannon) and SKIPPER seaplanes on the Amber Field runway (throttle down it and take off). The law reacts: stealing either draws heat, and a take-off scrambles a 3-star response.
- **HUD + minimap** — money, wanted stars, health (and vehicle health + speed while driving), mission line with timer, toasts, and a circular minimap with cop and objective markers.
- **Save** — money, jobs completed and lifetime earnings persist in `localStorage`.
- **Sound** — a small WebAudio synth (shots, crashes, pickups, jingles, stings, car entry), created on the first key press.

## Controls

| Keys | Action |
| --- | --- |
| WASD / arrows | Move on foot · drive |
| E | Enter / exit car |
| Space | Shoot (on foot) · handbrake (in car) |
| Shift | Sprint |
| Q | Weapon wheel (arrows pick, Q/Enter equips) |
| X | Detonate planted charges |
| P | Pause |
| H | Help |

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. The game is plain ES modules with zero dependencies and zero network requests; it plays fully offline from the static files in `game/`.

Deterministic screenshot staging is built in: `?shot=board`, `?shot=chase`, `?shot=mission` and `?shot=results` each build the seeded world, place a scene and step the real simulation to a fixed frame.
