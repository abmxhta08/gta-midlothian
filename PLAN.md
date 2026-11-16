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
- [x] Event bus, config folder (safe zones, brand mode, settings), data folder (weapons, vehicles)
- [x] School safe zones (weapons holster, no hostiles/police/wanted)
- [x] Reduced violence setting (default ON)
- [x] BRAND_MODE real/parody
- [x] Sprint stamina, vault, cover (peek, blind fire), player ragdoll, water handling
- [x] Weapon wheel (hold Q, slow-mo), bat, stun grenade, sniper with scope + sway, per-weapon stats data file
- [x] Vehicles: bus, van, taxi, muscle, compact, motorcycle, bicycle with handling table; carjack reactions; flip recovery; radio (3 synth stations)
- [x] Wanted upgrades: last known position search, roadblocks + spike strips (3+), tactical units (4+), helicopter with spotlight (5)
- [x] Weather (clear/rain/fog) affecting grip + visibility
- [x] Ped types: jogger, shopper, gang member, shopkeeper; ambient events (bag snatch, stranded driver, street race challenge)
- [x] Shops (clothes, snacks, ammo), gas station repair, paint shop (clears stars), safehouse, hospital + police station respawns
- [x] Stunt jumps, 20 hidden collectibles
- [x] Phone UI (contacts, map, missions, settings)
- [x] Save system v2 with migration

## Phase 3: missions and story
- [x] Data-driven MissionManager: 19 step types, objectives, dialogue/subtitles, checkpoints + retry (mission vehicles restored), fail conditions, medals, payout, wanted suppression
- [x] Port the 4 existing missions to data (delivery, race, heat, repo became side jobs)
- [x] Main story: 8 story missions + 2 heist missions = 10, allies Rosa Quill / Tick / Harlan Pryce, villain Victor Graves, ending
- [x] Heist (setup, loud/stealth choice, crew selection with cuts, job, getaway)
- [x] Side jobs: taxi, delivery, races with AI opponents, bounty (knock out + drop at police), tow/repo, plus "Heat Wave" and the ambient street-race challenge
- [x] Stealth: view cones, detection meter, silent takedown from behind (E)
- [x] tests/missions.test.mjs (34 checks) + TestBot that plays every mission through the real input path

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
