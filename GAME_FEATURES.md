# Midlothian: Game Features (current state)

A private, friends-only GTA-style open-world game set in Midlothian, VA. Runs in the browser (Three.js loaded from a CDN, no install, no build step). Map data © OpenStreetMap contributors.

Status as of 2026-11-16. Everything below exists in the code. It has been tested through scripted headless runs, not yet played at length with a real mouse and keyboard, so expect rough edges.

---

## Running it

```
python3 tools/serve.py
```
Open http://localhost:8791. Press **Space** (or Enter or click) to play. Port 8765 belongs to Fortlite. `netlify.toml` is set up to publish `game/` as a static site, but nothing is deployed yet.

---

## The world

**Map**
- Centered on Midlothian High School (401 Charter Colony Pkwy, 37.4966, -77.6603).
- Base radius is 1 mile. It grows to **1.22 mi** so cut-off landmarks (Village Marketplace, Mid-Lothian Mines Park, American Family Fitness, Carytown Tobacco) fit whole.
- Real OpenStreetMap data: 3,676 buildings, 1,252 road segments, 216 land areas, 72 streams, 324 crossings, 37 traffic signals, 80 stop signs, 100 named locations, 43 neighborhoods, 277 named streets.
- A dense forest ring surrounds the edge of the map and a hard boundary keeps you inside.

**Terrain and land use:** flat ground with large-scale color variation (lawn, dry patches), parks, forests, fields, water, athletic fields, tracks, parking lots, pools, playgrounds, cemetery.

**Roads**
- Asphalt with grain texture, curbs, and concrete sidewalks (with panel joints).
- Lane markings: double yellow, dashed white lanes, edge lines.
- Zebra crosswalks and stop bars at signals, stop signs and crossings.
- Parking lots with painted stall lines.
- Driveways running from the house to the street.

**Buildings**
- *Houses and townhouses:* gabled or hipped roofs with shingles, brick or lap siding in varied colors, brick foundation, windows with trim or shutters, front door with stoop, garage doors, chimneys, driveways, mailboxes, bushes, yard trees.
- *Apartments:* brick or siding, entrance canopies, rows of windows.
- *Commercial buildings:* storefront glass, awnings, rooftop HVAC units, flat roofs, **lit signs with the real business names** (brand colors for Kroger, Target, Starbucks, etc.).
- *Schools and offices:* brick, large windows, entrance canopy, name sign.
- *Churches:* steeple and pitched roof.
- *Sheds, storage units* (metal siding, roll-up doors).
- Some windows are lit at night; storefronts and signs glow.

**Vegetation:** ~45,500 trees (oak, maple, two kinds of pine, cedar) that sway in the wind, with a cheaper version drawn at distance. Hedges and bushes along house fronts.

**Street furniture:** street lights (with night glow pools), working **traffic lights** that cycle, stop signs, mailboxes, fire hydrants.

**Parked cars:** ~4,000 parked in lots and driveways, in 14 paint colors and four body types (sedan, hatchback, SUV, pickup). Any of them can be stolen.

---

## Graphics

- Physically based materials with procedural textures (nothing to download): asphalt, concrete, grass, siding, brick, block, metal, shingles, windows, doors, water.
- Real sky with sun position, clouds, stars at night, fog and haze.
- Sun shadows (up to 4096 map), sky-based reflections, ACES tone mapping.
- Post-processing: ambient occlusion, bloom (stronger at night), MSAA.
- **Four quality levels** (press **G**): Low, Medium, High, Ultra. Saved between sessions.
- **Day/night cycle:** one in-game hour per two real minutes. Press **T** to jump 1 hour ahead. Windows, signs and street lights come on at dusk, headlights follow your car.
- Skid marks, bullet holes, sparks, blood, smoke, fire and explosions.

---

## On-foot gameplay

- Third-person character with an articulated body (walk, run, jump, aim, punch, hands-up animations). The player is an invented generic character.
- Over-the-shoulder camera with wall collision, aim zoom, recoil, three camera distances (**C**).
- Health and body armor.

### Weapons (keys 1–5 or mouse wheel)

| Slot | Weapon | Notes |
|---|---|---|
| 1 | Fists | melee |
| 2 | Pistol | 12-round magazine, semi-auto |
| 3 | SMG | 30 rounds, full auto |
| 4 | Pump shotgun | 6 shells, 8 pellets per shot |
| 5 | Carbine rifle | 30 rounds, full auto, long range |

Reload with **R**. Headshots do extra damage. Weapons are found as pickups around town.

---

## Vehicles

- Four body types plus police cruisers, each a proper 3D model with wheels that spin and steer, working headlights, brake lights and body roll.
- Arcade driving physics with grip, handbrake drifts, skid marks and top speeds around 100 mph.
- Collision with buildings, trees, poles, parked cars and other cars.
- **Damage:** cars smoke when hurt, catch fire, then **explode**. Explosions damage nearby people and cars.
- **Enter, exit, steal:** F or E. Break into parked cars, carjack drivers on the road (they get out and run), steal police cruisers.
- Horn (**H**), handbrake (**Space**), chase camera that widens with speed.

---

## Living city

**Pedestrians**
- Walk along sidewalks, stop and idle, dodge cars, run away from gunfire and violence, scream.
- Can be punched, shot or run over, and sometimes drop cash.
- Generic invented civilians only (random skin, hair, clothes). **No people spawn on any school campus.**

**Traffic**
- AI cars follow the real road network in the right lane, slow for corners and other cars, **stop at red lights and stop signs**, and honk when blocked.
- They panic and flee when shot at, and crash or stop when hit.

---

## Police and wanted level

- **1–5 star** wanted level shown in the top right.
- Crimes: gunfire, hitting people, killing, stealing cars, hurting cops, destroying police cars, explosions.
- Police cruisers with working sirens and flashing lights chase and ram you. Officers get out to arrest you (low stars) or shoot you (higher stars).
- Hide out of sight to lose them. The stars flash while police search for you.
- **WASTED** screen when you die ($100 hospital bill) and **BUSTED** screen when arrested (weapons confiscated). Both respawn you in town.

---

## Missions

Four yellow lettered markers on the map. Drive or walk into one to start.

| | Mission | What you do |
|---|---|---|
| D | **Special Delivery** | Pick up a package, deliver it across town against a timer |
| R | **Street Race** | Drive through a series of glowing checkpoint gates before time runs out |
| T | **Fare Game** | Pick up three passengers and drive each to a destination for fares |
| H | **Heat Wave** | Start with 3 stars and lose the cops |

Destinations are real places on the map (the YMCA, shopping centers, etc.). Each shows a GPS route, a countdown timer and cash rewards.

---

## Maps, names and location pop-ups

- **Minimap** (bottom left): rotates with you, shows your GPS route, blips for missions, pickups and police, and an N marker. Zooms out as you speed up.
- **Full map (press M):** drag to pan, scroll to zoom, labels for neighborhoods, named locations and streets, all blips. **Click to set a GPS waypoint**, right-click to clear it. Press M again to close.
- **Location pop-ups:** large GTA-style name card when you enter a named place (Midlothian High School, Kroger, YMCA, parks, churches, shopping centers, etc.), plus neighborhood names (Madison Village, Charter Colony, Winterfield...). Street names appear when driving.

---

## Pickups and economy

- Health, body armor, weapons and cash scattered around named locations, respawning after a while.
- Cash from missions, fares and dropped money. Money, graphics quality and time of day are saved in the browser.

---

## HUD

Health and armor bars, money, wanted stars, weapon and ammo, speedometer in a car, crosshair with hit marker, objective text, mission timer, red screen flash when hurt, toast messages, a help box at the start.

---

## Audio

Everything is synthesized, no audio files: gunshots (different per weapon), engine that changes with speed, tire skids, crashes, explosions, horn, police siren, pickups, cash, reloads, mission jingles, ambient city bed, screams.

---

## Controls

| Key | Action |
|---|---|
| W A S D | Move / drive |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump (on foot) / handbrake (in car) |
| Left click | Shoot / punch |
| Right click | Aim |
| 1–5 or mouse wheel | Switch weapon |
| R | Reload |
| F or E | Enter / exit / steal vehicle |
| H | Horn |
| M | Full map |
| T | Advance time 1 hour |
| G | Cycle graphics quality |
| C | Cycle camera distance |
| Esc | Pause |

---

## Project layout

```
gta-midlothian/
├── GAME_FEATURES.md        this file
├── README.md
├── netlify.toml            publishes game/ as a static site
├── tools/
│   ├── fetch_osm_api.py    builds game/data/midlothian.json from OpenStreetMap
│   ├── serve.py            local dev server (caching off)
│   └── .cache/             downloaded OSM tiles
└── game/
    ├── index.html
    ├── data/midlothian.json
    └── src/
        ├── main.js         game loop, camera, vehicles, state
        ├── world/          ground, roads, buildings, trees/props, materials
        ├── entities/       humans, car models, vehicle physics
        ├── player.js  peds.js  traffic.js  police.js  combat.js
        ├── weapons.js  pickups.js  missions.js  effects.js
        ├── sky.js  post.js  textures.js  audio.js  input.js
        ├── collision.js  mapdata.js  util.js
        └── ui/             hud.js, fullmap.js, style.css
```

Testing hook: `index.html?steps=300&auto=drive` runs a scripted headless test (modes: walk, drive, shoot, chaos, map, look, mission). `&t=21` sets the hour, `&q=0..3` sets quality.

---

## Known gaps and issues

- **Start screen:** reported by the user as not hiding on their machine. It works in my automated Chrome tests, so the cause is not yet known. A build stamp on the start screen shows which code version the browser is running.
- **Not yet play-tested** with a real mouse and keyboard, and frame rate on the user's hardware is unknown (press **G** to lower quality).
- Terrain is flat (no elevation data).
- People are built from simple shapes rather than detailed models.
- Interiors do not exist; buildings are solid shells.
- Gunfire can give a wanted star even when no cop is nearby (35% chance per shot).
- Single-player only. Multiplayer (Supabase) is not started.
- Not deployed to Netlify yet.
- OSM coverage is uneven, so some buildings are generic and house heights are estimated.

## Ideas for next steps

Elevation data, more mission types and a story chain, shops and clothing, buying property, motorcycles and boats, weather, more NPC types and conversations, building interiors for key landmarks, multiplayer with friends, Netlify deployment.
