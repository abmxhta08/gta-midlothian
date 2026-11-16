# Tests

Playwright drives the real game in Chromium (installed Chrome), Firefox and WebKit. Every suite fails on
page errors, console errors and failed requests (404s), prints PASS/FAIL per check and exits nonzero on failure.
Results and screenshots go to `tests/artifacts/` (git-ignored).

```
cd tests
npm install                      # once: playwright 1.49.1
npx playwright install firefox webkit   # once (Chromium uses your installed Chrome)
npm test                         # every suite (node run-all.mjs), summary at the end
npm run test:quick               # everything except world/perf/bot/screens (~8 min)
SUITES=missions,ui node run-all.mjs
BROWSER=firefox node gameplay.test.mjs
ONLY="retry" node missions.test.mjs     # filter checks by name
```

The game exposes `window.__game` and `window.__test` only with `?test=1`.

| Suite | Covers |
|---|---|
| `boot` | loads in all 3 browsers, start screen hides with real Space/Enter/click, pointer lock allowed and denied |
| `phase1` | error overlay, runtime error banner, F3 debug panel, witness-based wanted level |
| `gameplay` | movement, stamina, vault, cover, weapons, wheel, shops, pickups, collectibles, school safe zones, reduced violence |
| `vehicles` | every vehicle type, carjacking, drift, flips, flooding, bikes, paint shop, radio |
| `wanted` | crime levels, search + evasion, roadblocks, tactical units, helicopter, busted/wasted |
| `missions` | every mission starts, pass/payout/save, each fail condition, retry from checkpoint, no double start, no missions in school zones |
| `save` | save/load round trip through a reload, v1 -> v2 migration, corrupt save, story unlocks persist |
| `world` | ped/traffic caps + despawn, nothing inside buildings/water, roads unblocked, road graph connected, collision NaN grid, bot driving tour |
| `ui` | layout at 1280x720 and 1920x1080, title Continue/New Game confirm, settings persist, menus, map waypoint, gamepad |
| `perf` | FPS on Medium, draw calls and triangles |
| `bot` | TestBot plays every mission (teleports/assists logged as bugs) + live 10-minute tour with FPS, 1% low, heap, entity counts per quality |
| `screens` | screenshots at key moments + black-frame check (`SIZES=1280x720,1920x1080`) |

`BOT_MINUTES=2 node bot.test.mjs` shortens the live run; `BOT_IDS=homecoming,repo` limits the missions.
