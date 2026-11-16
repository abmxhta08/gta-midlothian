# Midlothian

Private, friends-only GTA-style browser game set in Midlothian, VA, centred on Midlothian High School.
Three.js from a CDN, no build step, nothing to install.

## Run locally

```
python3 tools/serve.py
```

(Serves `game/` with caching disabled so refreshes always pick up code changes.)

Open http://localhost:8791 and click to play. (Port 8765 is used by Fortlite.)

## Deploy

Netlify serves the `game/` folder as-is (see `netlify.toml`). Keep the link private.

## Map data

`game/data/midlothian.json` is generated from OpenStreetMap:

```
python3 -I tools/fetch_osm_api.py          # 1-mile radius, grows to fit cut-off landmarks
python3 -I tools/fetch_osm_api.py --refresh  # re-download tiles
```

Uses the main OSM API in small tiles (cached in `tools/.cache/`), because Overpass is often unreachable.
Map data © OpenStreetMap contributors (ODbL).

## Layout

- `game/src/world/` procedural city: ground, roads and markings, buildings, trees, props, parked cars
- `game/src/entities/` people (procedural humans) and vehicles
- `game/src/` gameplay: player, peds, traffic, police, combat, pickups, missions
- `game/src/ui/` HUD, minimap, full map
- Debug: `index.html?steps=300&auto=drive` runs a scripted test; `&t=21` sets the hour; `&q=0..3` sets graphics quality.
