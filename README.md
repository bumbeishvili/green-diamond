# Green Diamond: Dighomi Outbreak

A first-person zombie-wave shooter set in the **Green Diamond** (მწვანე ალმასი) residential
complex at 32 Bob Walsh Street, Dighomi, Tbilisi. It runs in the browser (three.js).

## Play

Double-click **`start.command`**. Or run:

```sh
python3 tools/serve.py        # then open http://127.0.0.1:8765
```

It has to be served over http. Opening `index.html` as a file won't work.

### Controls (laptop / trackpad friendly)

| Key | Action |
|---|---|
| WASD, Shift, Space, C | move, sprint, jump, crouch |
| Click | shoot (hold the trackpad button for the AK) |
| E (or hold right-click) | aim down the sights / sniper scope |
| Shift while scoped | hold your breath to steady the SVD |
| R | reload |
| Q or 1–4 | switch weapon (1 Makarov, 2 AK-74, 3 shotgun, 4 SVD) |
| V | knife |
| F | buy at a shop (stand on the yellow ring) |
| G | flashlight (switches on by itself after dark) |
| M | big map |
| H | hide or show the key strip |
| Esc | pause |

### How it plays

- Zombies come in waves: out of the lobbies, up the underground-garage ramps, through the Bob Walsh Street gates, over the courtyard railing, and through broken fence panels on the construction side.
- The clock is real Tbilisi sun: wave 1 starts at 17:15, sunset comes around wave 8, and it's night after that.
- You earn points for hits and kills. Spend them at the shops on the podium:

| Place | Sells |
|---|---|
| Spar | AK-74 / AK ammo |
| Nikora | TOZ-194 shotgun |
| 2 Nabiji | ammo for everything (600) |
| 36.6 pharmacy | more health |
| Format Fit | faster legs |
| TBC terminal | double points |
| Gate 2 security booth | SVD Dragunov |
| Ammo crate by the pool house (middle courtyard) | ammo for everything (750) |

Guns you already own are half price at their shop, and buying one again refills its ammo.

- Power-ups sometimes drop from kills: Max Ammo, Insta-Kill, Double Points, Nuke.
- If you fall into a pool, walk out up the steps (by the chrome rails), or jump at any edge.

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
- **Surroundings:** the Olympic arenas and pitches across Bob Walsh Street, and the forest and construction sites to the west. The hills around Tbilisi use real elevation data draped with Sentinel-2 imagery, and 900 real high-rises form the skyline.

## Project layout

```
index.html, src/          the game (ES modules, no build step)
  world/                  ground, buildings, props, sky, surroundings
  game/                   player, weapons, zombies, pathfinding, waves, HUD, audio
data/                     generated level, heightmap, terrain, skyline
assets/                   models, textures, audio (see the CREDITS files)
tools/build_level.py      OSM -> data/level.json + heightmap (python3, shapely)
tools/fetch_backdrop.py   terrain, imagery, skyline downloads
tools/shot.mjs            headless screenshots (Playwright) for testing
vendor/three/             three.js r186
```

Debug URL flags: `?debug` (fps overlay), `?time=19.5`, `?wave=5`, `?god`,
`?nozombies`, `?quality=low`, `?cam=x,y,z,yaw,pitch`.

## Credits

- Map data © OpenStreetMap contributors (ODbL).
- Terrain: AWS Terrain Tiles.
- Imagery: Sentinel-2 cloudless 2024 by EOX IT Services (CC BY-NC-SA 4.0; personal, non-commercial use).
- 3D models by Quaternius, Kenney, J-Toastie, Rikindle3D, dogchicken, bachosoftdesign and others: see `assets/models/CREDITS.md`.
- Textures, sounds and HDRIs: see `assets/CREDITS_media.md`.
- Built with three.js.

This is a personal fan project. Green Diamond is a development by MAQRO Construction; the brands shown belong to their owners.
