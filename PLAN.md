# PLAN

Browser game (vanilla ES modules + Three.js CDN, no build step, single-player). Work goes phase by phase; each phase ends with the test suite run and a git commit. Judgment calls are in DECISIONS.md.

## What exists (baseline commit 8c3f937)
- 1.22 mi OSM world: procedural houses/stores/schools/churches, roads with markings, sidewalks, 45k instanced trees, 4k instanced parked cars, street lights, working traffic lights, stop signs.
- Sky, shadows, AO, bloom, 4 quality levels, day/night cycle.
- Player on foot (walk/run/jump/aim), 5 weapons, 4 car types + police, arcade driving, damage/fire/explosions.
- Pedestrians, lane-following traffic, police with 5-star wanted, WASTED/BUSTED.
- 4 hard-coded missions, pickups, minimap, full map (M) with labels and waypoints, location pop-ups, synthesized audio.
- Scripted headless test modes (`?steps=&auto=`).

## What is broken / risky
- [x] Start screen does not hide on the user's machine (not reproducible in headless Chrome so far).
- [x] Any exception inside the render loop silently stops three.js's animation loop, freezing the game on one frame.
- [x] Gunfire gives a wanted star 35% of the time with no witness.
- [x] No error overlay, no debug/FPS panel, no perf numbers per quality level.
- [x] No cache busting for ES modules.

## Phase 1: fix known breakage
- [x] Playwright harness (Chrome channel + Firefox + WebKit), real input events, pointer lock allowed/denied
- [x] Robust start flow (hide first, lock second in try/catch, drag-look fallback), loop guarded by try/catch
- [x] Cache busting via build stamp + no-store dev server
- [x] Global error overlay
- [x] F3 debug panel (FPS, frame time, draws, tris, entities, memory, build)
- [x] Witness-based wanted rule
- [x] FPS per quality level measured and logged; fix obvious hotspots

## Phase 2: GTA core feel
- [ ] Event bus, config folder (safe zones, brand mode, settings), data folder (weapons, vehicles)
- [ ] School safe zones (weapons holster, no hostiles/police/wanted)
- [ ] Reduced violence setting (default ON)
- [ ] BRAND_MODE real/parody
- [ ] Sprint stamina, vault, cover (peek, blind fire), player ragdoll, water handling
- [ ] Weapon wheel (hold Q, slow-mo), bat, stun grenade, sniper with scope + sway, per-weapon stats data file
- [ ] Vehicles: bus, van, taxi, muscle, compact, motorcycle, bicycle with handling table; carjack reactions; flip recovery; radio (3 synth stations)
- [ ] Wanted upgrades: last known position search, roadblocks + spike strips (3+), tactical units (4+), helicopter with spotlight (5)
- [ ] Weather (clear/rain/fog) affecting grip + visibility
- [ ] Ped types: jogger, shopper, gang member, shopkeeper; ambient events (bag snatch, stranded driver, street race challenge)
- [ ] Shops (clothes, snacks, ammo), gas station repair, paint shop (clears stars), safehouse, hospital + police station respawns
- [ ] Stunt jumps, 20 hidden collectibles
- [ ] Phone UI (contacts, map, missions, settings)
- [ ] Save system v2 with migration

## Phase 3: missions and story
- [ ] Data-driven MissionManager: step types, objectives, dialogue, checkpoints/retry, fail conditions, medals, payout, wanted suppression
- [ ] Port the 4 existing missions to data
- [ ] Main story (10 missions, 3 allies + villain, ending)
- [ ] Heist (setup, loud/stealth choice, crew selection, job, getaway)
- [ ] Side jobs: taxi, delivery, races with AI opponents, bounty targets, tow/repo

## Phase 4: UI and polish
- [ ] Title screen (Continue / New Game with confirm / Settings), loading progress
- [ ] Settings (volume, sensitivity, keybinds, quality, reduced violence, brand mode)
- [ ] Mission HUD, weapon wheel UI, phone UI
- [ ] Gamepad support
- [ ] Layout checks at 1280x720 and 1920x1080

## Phase 5: testing and bug fixing
- [ ] Test hooks behind `?test=1`
- [ ] Test suite A–D (see tests/README.md)
- [ ] Bot playthrough with perf sampling
- [ ] Screenshot review
- [ ] Fix loop + TEST_REPORT.md

## Stretch (not planned for this pass)
- Character switching between multiple protagonists
- Building interiors
- Multiplayer (explicitly out of scope)
