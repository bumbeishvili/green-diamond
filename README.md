# Green Diamond: Dighomi Outbreak

A first-person zombie-wave shooter set in the **Green Diamond** (მწვანე ალმასი) residential
complex at 32 Bob Walsh Street, Dighomi, Tbilisi. It runs in the browser (three.js).

## Play

Double-click **`start.command`**. Or run:

```sh
python3 tools/serve.py        # then open http://127.0.0.1:8765
```

It has to be served over http. Opening `index.html` as a file won't work.

### Play with friends (in progress)

Up to 4 players join the same match by typing the same password under **Play with friends**
in the menu. It's peer-to-peer: the first player in hosts and the others connect straight to the
host over WebRTC. The server only helps them find each other.

Milestone 1 (now): connecting and measuring. The overlay in the top-right corner (F8 hides it)
shows your role, the tick rate, and each player's ping and packet loss. The "Simulate a bad
network" sliders (or `?lag=100&jitter=20&loss=5`) add delay, jitter and loss so you can test a bad
connection on a good one. Movement, shooting and the match itself come in the next milestones.

To try it locally (no account needed):

```sh
npm install
npm run dev                   # then open http://127.0.0.1:8787 in 2 to 4 browser windows
```

How it works:
- On Vercel, `api/` holds four small functions: `join`, `signal`, `inbox` and `leave`. They keep
  the handshake state in a private Vercel Blob store.
- Every read bypasses the cache, and every write is create-only or conditional on the ETag, so
  function instances never see stale data or overwrite each other.
- A room is a hash of the password; the password itself is never stored.
- `tools/dev.mjs` runs the same functions locally, with an in-memory store.
- The only outside service is Google's public STUN server. There is no relay (TURN), so a network
  that blocks direct connections gets a clear "can't connect from this network" message after
  about 15 seconds.

### Controls (laptop / trackpad friendly)

| Key | Action |
|---|---|
| WASD, Shift, Space, C | move, sprint, jump, crouch |
| Click | shoot (hold the trackpad button for automatic guns; hold and release to draw and loose the bow) |
| E (or hold right-click) | aim down the sights / scope |
| Shift while scoped | hold your breath to steady the scope |
| R | reload |
| 1–7 | weapon group: 1 pistols, 2 rifles, 3 shotgun, 4 snipers, 5 machine gun, 6 bow, 7 knife (press again for the next gun in the group) |
| Q | next weapon |
| G | throw an F-1 grenade (about 3 s fuse) |
| V | quick knife |
| F | buy at a shop, take the stairs at a lobby door or roof door, get in or out of a car, motorbike or drone |
| L | flashlight (switches on by itself after dark) |
| M | big map |
| H | hide or show the key strip |
| Esc | pause |

Driving a car or riding a motorbike: W/S throttle and brake (hold S to reverse), A/D steer, Space handbrake. The camera looks down on you from above and behind, and your guns are put away: you run the dead down instead. Nothing can touch you inside a car; on the bike they can only grab you once you slow to a crawl. Handling is roughly true to life: the wheel turns in progressively, you can't corner harder than the tyres grip (so the faster you go, the wider you turn), scraping a wall slides you along it, and the bike leans into corners.
Drone: WASD to move where you look, Space to climb, C or Shift to descend, and you can shoot from it. Land on a roof and step out.

### How it plays

- Zombies come in waves: out of the lobbies, up the ramps from the underground car parks, through the Bob Walsh Street gates, over the courtyard railing, and through broken fence panels on the construction side.
- Kinds of zombie: walkers; runners; crawlers (low, hard to hit); brutes (big, soak up bullets, knock you back); screamers (stop and scream, which speeds up everything nearby and brings more); bloaters (glowing hazmat suits that burst when they reach you or die, taking out anything close). From wave 3, packs of stray dogs (a wolf leads them from wave 6); from wave 4, crows that dive at your head. The animals nip rather than maul, but they're fast. Crows find you on the roofs and in the drone too.
- Under each courtyard is an underground car park, a whole parking level with rows of parked cars, columns and strip lights. The ramps the zombies come up lead down into it: walk or drive down. Zombies come up out of it, follow you down into it, and take the nearest ramp back out when you leave.
- The clock is real Tbilisi sun: wave 1 starts at 17:15, sunset comes around wave 8, and it's night after that.
- Every block with a roof housing has stairs. Press F at a lobby door to go up and at the roof door to come down. The zombies use the stairs too, so a roof is a choke point, not a safe room.
- Ammo cans, first-aid kits and bundles of lari lie around the complex, some of them up on the roofs. More turn up every wave (they show on the minimap).
- You earn points for hits and kills. Spend them at the shops:

| Place | Sells |
|---|---|
| Spar | AK-74 |
| Assorti | M4A1 carbine (holographic sight) |
| Diamond salon | Desert Eagle .50 AE |
| Nikora | TOZ-194 pump shotgun |
| 2 Nabiji | ammo and grenades for everything (600) |
| 36.6 pharmacy | more health |
| Format Fit | faster legs |
| TBC terminal | double points |
| Gate 2 security booth | SVD Dragunov |
| Gate 1 security booth | M60 machine gun |
| Crate by the stadium (middle courtyard) | compound bow |
| Cache on the twin tower roof (take the stairs) | FN SCAR 20S auto sniper |
| Ammo crate by the pool house (middle courtyard) | ammo and grenades for everything (750) |

Guns you already own are half price at their shop, and buying one again refills its ammo.

- Weapons behave like the real ones: recoil climbs and drifts, spread blooms when you hold the trigger, tactical reloads keep a round in the chamber, the shotgun loads shell by shell. Rifle rounds go through car bodies and through a zombie or two. Arrows drop with distance and stick where they land; walk over them to pick them up.
- Every parked car can be driven, and there are motorbikes and one-person drones around the complex. Cars and bikes run zombies down, but they can still reach you through the door.
- Power-ups sometimes drop from kills: Max Ammo, Insta-Kill, Double Points, Nuke.
- Falling more than a couple of storeys hurts. If you fall into a pool, walk out up the steps (by the chrome rails), or jump at any edge.

### Graphics

The game picks Low, Medium or High from your GPU on the first run. You can change it in the menu. It also lowers the render resolution by itself whenever the frame rate drops below about 50 fps, so it stays smooth on laptops.

## What is real

- **Layout:** every building footprint, road, parking bay, fence, gate, pool and garage ramp comes from OpenStreetMap. Lawns, playgrounds and pergola spots were checked against satellite imagery.
- **Floor counts:** from the developer's block list.
  - K2–K5, K7, K8: 9 floors
  - K1, K9: 11
  - K6, K10: 21
  - the twin towers on the podium: 22
  - the northern "34" blocks: 9 / 11 / 20
- **Facades:** matched to the developer's photos.
  - Stage-1 blocks: white with coloured picture-frame balconies.
  - K6/K10: grey-beige towers.
  - The twins: charcoal.
  - Stage-3 blocks: vertical colour stripes.
  - Timber pergolas on the roofs, the Gate 2 portal and the glass diamond.
- **Shops:** the real shops on the podium: Spar, Nikora, 2 Nabiji, 36.6, Format Fit, Assorti, Diamond, TBC.
- **Underground parking:** the eight ramps from OpenStreetMap lead down into the parking levels under the middle and northern courtyards, as in the complex; the layout down there (aisles, stalls, columns) is a standard one, not surveyed.
- **The small stadium:** the round red-rubber court with the tall green mesh fence and the glass-backboard hoop at the west end of the middle courtyard, placed from the satellite imagery and the developer's photos.
- **Surroundings:** the Olympic arenas and pitches across Bob Walsh Street, and the forest and construction sites to the west. The hills around Tbilisi use real elevation data draped with Sentinel-2 imagery, and 900 real high-rises form the skyline.

## Project layout

```
index.html, src/          the game (ES modules, no build step)
  world/                  ground, buildings, props, sky, surroundings
  game/                   player, weapons, zombies, vehicles, stairs, pickups, pathfinding, waves, HUD, audio
  net/                    multiplayer: WebRTC links, session, network simulator, lobby and overlay
api/                      Vercel Functions for the multiplayer handshake (Vercel Blob storage)
data/                     generated level, heightmap, terrain, skyline
assets/                   models, textures, audio (see the CREDITS files)
tools/build_level.py      OSM -> data/level.json + heightmap (python3, shapely)
tools/fetch_backdrop.py   terrain, imagery, skyline downloads
tools/shot.mjs            headless screenshots (Playwright) for testing
tools/dev.mjs             local server with the multiplayer API (npm run dev)
tools/make_plates.py      Georgian number plates for the detailed cars
vendor/three/             three.js r186
```

Debug URL flags: `?debug` (fps overlay), `?time=19.5`, `?wave=5`, `?god`,
`?nozombies`, `?quality=low`, `?cam=x,y,z,yaw,pitch`.

## Credits

- Map data © OpenStreetMap contributors (ODbL).
- Terrain: AWS Terrain Tiles.
- Imagery: Sentinel-2 cloudless 2024 by EOX IT Services (CC BY-NC-SA 4.0; personal, non-commercial use).
- 3D models by Quaternius, Kenney, J-Toastie, Rikindle3D, dogchicken, bachosoftdesign, Benjinsmith (zombie crow, CC-BY 3.0), mightydinosaurcol (M60, CC-BY 4.0), jeremy (motorbike, CC-BY 3.0), SirDraco65, Pichuliru, LonesomeDucky, AdamKokrito, Lucian Pavel, Teh_Bucket and others: see `assets/models/CREDITS.md`. The compound bow, arrow and personal drone were modelled for this project.
- Textures, sounds and HDRIs: see `assets/CREDITS_media.md`.
- Built with three.js.

This is a personal fan project. Green Diamond is a development by MAQRO Construction; the brands shown belong to their owners.
