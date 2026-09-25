# Green Diamond: Dighomi Outbreak

A first-person zombie-wave shooter set in the **Green Diamond** (მწვანე ალმასი) residential
complex at 32 Bob Walsh Street, Dighomi, Tbilisi. It runs in the browser (three.js).

## Play

Online: **https://diamond.infoicy.com** (also https://green-diamond.dato-developer.workers.dev and
https://green-diamond-kohl.vercel.app; for playing with friends over the internet, use one of the
first two: only they have the relay that gets round networks that block direct connections).

To run it yourself, double-click **`start.command`**. Or run:

```sh
python3 tools/serve.py        # then open http://127.0.0.1:8765
```

It has to be served over http. Opening `index.html` as a file won't work.

### Phones and tablets

Turn the phone sideways. A stick appears wherever your left thumb lands: push it to walk (all the
way forward to sprint), or in a car to drive. Drag on the right half of the screen to look round
(dragging off FIRE aims while you shoot). The buttons do the rest: AIM, JUMP (BRAKE in a car, UP in
the drone), DUCK, RELOAD, SWAP, NADE, USE (when there's something to use), TALK in multiplayer,
pause and full screen. Tap the minimap for the big map, or a prompt to do what it says. Phones start
on the Phone graphics setting: a lighter picture, and fewer zombies at once.

**Full screen:** in Settings (from the menu or the pause screen), or ⛶ in the game. On an iPhone, Safari
can't go full screen, so add the page to the home screen (Share, then Add to Home Screen) and play
from there: it opens full screen, sideways.

### Play with friends (co-op or against each other)

Up to 4 players. Under **Or play with friends**, type your name, leave the password empty and press
**Create room**. Then press **Copy link** and send it to your friends: they open it, type their name
and press **Join**. Or they paste the link (or just the password) into the password box: that takes
them straight into the room. (Or everyone types the same password and presses **Join**; the first
one in hosts.) The host picks the game, and the others see what was picked:

- **Mode**: co-op against the zombies; PvP, everyone for themselves; or PvP in two teams. In teams,
  the host clicks a name to move that player to the other side.
- **Zombies** (PvP): around, or none.
- **Time** (PvP): 5 to 20 minutes (10 by default).
- **Win at** (PvP): 10 to 50 kills, or no limit (the most kills when the clock runs out wins).

When everyone is in, the host presses **Start match**. Two players is enough, and friends can join a
match that's already running (in co-op they turn up next to the team; in teams, on the smaller side).

Co-op:
- **The match**: no clock. Wave after wave, as alone, but grown for the team, until the whole team
  is down at once.
- **Going down**: you come back after 4 seconds, next to a teammate. If the whole team is down at
  once, it's over.
- **Points and shops**: everyone has their own points, weapons and ammo. Power-ups (max ammo,
  insta-kill, double points, nuke) work for the whole team.

PvP:
- Guns, the knife, the chainsaw, grenades, missiles and cars hurt the other side
  (in teams, never your own side; your own grenade still can). Against a player a gun does half what
  it does to a zombie, and upgrades count for less.
- **Dying**: you're back 4 seconds later, somewhere away from whoever wants you dead, and nothing can
  hurt you for 2 seconds. The kill goes to whoever hurt you last (within a few seconds); the
  zombies' kills go to nobody.
- The board on the left shows everyone's kills and deaths (and the teams' totals); who killed whom
  shows on the right. Foes aren't on your map, their name tags don't show through walls, and you
  can't see their health.
- Zombie kills still pay (buy guns, armour, upgrades); a player kill pays 250 (a knife kill 400).

Both:
- **Cars, motorbikes and drones**: one player per vehicle, and whoever gets in first has it. The
  others see you drive; running zombies down earns you the points.
- **Voice**: hold T to talk (or leave the microphone open, or turn it off, in the F8 panel).
- **Esc** opens the menu, but the match goes on around you. If the host leaves, the match ends
  for everyone.

The panel in the top-right corner (F8 hides it) shows who's hosting, the tick and snapshot rates,
and everyone's ping and packet loss. "Simulate a bad network" (or `?lag=100&jitter=20&loss=5`) adds
delay, jitter and loss so you can feel a bad connection on a good one.

To try it locally (no account needed):

```sh
npm install
npm run dev                   # then open http://127.0.0.1:8787 in 2 to 4 browser windows
```

How it works:
- It's peer-to-peer: the first player in hosts, the others connect straight to the host over
  WebRTC. The host runs the whole game (zombies, waves, loot, and a copy of every player moved by
  their inputs) on a 60 Hz tick, checks every hit, and sends each player a snapshot 30 times a
  second.
- Your own movement is predicted on your screen; when the host disagrees, you take its position and
  replay the inputs it hasn't seen yet, blended in over a few frames. Zombies and teammates are
  drawn 100 ms in the past, between two snapshots. Vehicles work the same way: the host drives
  everyone's from their inputs, and you predict your own.
- An invite link carries the room code after the `#`, which browsers never send to a server. A room
  made with **Create room** gets a random 14-character code.
- Lag compensation: shots are checked against where the zombies were on the shooter's screen, up
  to 300 ms back.
- The server only introduces players to each other. On Vercel, `api/` holds four small functions
  (`join`, `signal`, `inbox`, `leave`) that keep the handshake in a private Vercel Blob store: every
  read bypasses the cache, and every write is create-only or conditional on the ETag, so function
  instances never see stale data or overwrite each other. A room is a hash of the password; the
  password itself is never stored. `tools/dev.mjs` runs the same functions locally with an
  in-memory store.
- The only outside service is Google's public STUN server. A network that blocks direct
  connections can't reach the host that way: on Cloudflare the game then goes through the room's
  own relay (below) by itself; on Vercel there's no relay, and after about 15 seconds it says
  "can't connect from this network" (a phone hotspot usually works).

It also runs on Cloudflare, as one Worker (`wrangler.jsonc`, `cloudflare/`). The static files come
straight from Workers static assets (`.assetsignore` lists what isn't served). The same four
functions from `api/` run in the Worker, but each room lives in its own Durable Object instead of
Blob, on the free plan. The room also works as a doorbell: the host keeps a WebSocket open to it,
and any change to the room rings it. So the host doesn't poll, and a friend's offer is answered
within milliseconds.

```sh
npx wrangler dev --persist-to /tmp/gd-wrangler   # local, http://127.0.0.1:8787 (keeps its state out of the folder it serves)
npx wrangler deploy                              # then once: npx wrangler secret put ROOM_SECRET
```

### Controls (laptop / trackpad friendly)

| Key | Action |
|---|---|
| WASD, Shift, Space, Ctrl | move, sprint, jump, crouch (Ctrl on Mac too) |
| Click | shoot (hold the trackpad button for automatic guns; hold and release to draw and loose the bow) |
| E (or hold right-click) | aim down the sights / scope |
| Shift while scoped | hold your breath to steady the scope |
| R | reload |
| 1–7 | weapon group: 1 pistols, 2 rifles (AK-74, M4A1, AUG), 3 shotgun, 4 snipers (SVD, SCAR 20S, MSR), 5 heavy (M60, mini-missile launcher, laser rifle), 6 bow, 7 knife and chainsaw (press again for the next in the group) |
| Q | next weapon |
| G | throw an F-1 grenade (about 3 s fuse) |
| V | quick knife |
| T | talk (co-op and PvP) |
| F | buy at a shop, take the stairs at a lobby door or roof door, get in or out of a car, motorbike or drone |
| L | flashlight (switches on by itself after dark) |
| M | big map |
| H | hide or show the key strip |
| Esc | pause |

Driving a car or riding a motorbike: W/S throttle and brake (hold S to reverse), A/D steer, Space handbrake. The camera looks down on you from above and behind, and your guns are put away: you run the dead down instead. Nothing can touch you inside a car; on the bike they can only grab you once you slow to a crawl. Handling is roughly true to life: the wheel turns in progressively, you can't corner harder than the tyres grip (so the faster you go, the wider you turn), scraping a wall slides you along it, and the bike leans into corners.
Drone: WASD to move where you look, Space to climb, Ctrl or Shift to descend, and you can shoot from it. Land on a roof and step out.

### How it plays

- Zombies come in waves: out of the lobbies, up the ramps from the underground car parks, through the Bob Walsh Street gates, over the courtyard railing, and through broken fence panels on the construction side.
- Kinds of zombie: walkers; runners; crawlers (low, hard to hit); brutes (big, soak up bullets, knock you back); screamers (stop and scream, which speeds up everything nearby and brings more); bloaters (glowing hazmat suits that burst when they reach you or die, taking out anything close). From wave 3, packs of zombie dogs, mangy and rotting, ribs through a torn flank, eyes burning (a wolf leads them from wave 6); from wave 4, crows that dive at your head. The animals nip rather than maul, but they're fast. Crows find you on the roofs and in the drone too.
- And newer ones: **leapers** (wave 4 on) crouch a few metres off and pounce, knocking you down; **spitters** (wave 5 on) keep their distance and spit acid in an arc, and the puddle burns while you stand in it; **riot police** (wave 6 on) carry a helmet and a პოლიცია shield that stops most bullets from the front: shoot their legs, catch them mid-swing, get round them or blow them up; and every fifth wave a **giant** twice your height, with its health bar across the top. It shrugs off a magazine or three, flings you, stops a car dead and smashes the one you're sitting in.
- Sitting in a car doesn't save you for long: zombies claw at it, dent it and break the windows, then reach in, and when it's a wreck they drag you out.
- Under each courtyard (and under the pool court between Spar and Nikora) is an underground car park, a whole parking level with rows of parked cars, columns and strip lights. The ramps the zombies come up lead down into it: walk or drive down. Zombies come up out of it, follow you down into it, and take the nearest ramp back out when you leave.
- The clock is real Tbilisi sun: wave 1 starts at 17:15, sunset comes around wave 8, and it's night after that.
- Every block with a roof housing has stairs. Press F at a lobby door to go up and at the roof door to come down. The zombies use the stairs too, so a roof is a choke point, not a safe room.
- Ammo cans, first-aid kits, bundles of lari and now and then a gun lie around the complex, some of them up on the roofs. More turn up every wave and during it (they show on the minimap). A gun you don't have is yours; one you have, its ammo.
- You earn points for hits and kills, and more as the waves get tougher (a kill pays about 2.5 times as much by wave 10). Spend them at the shops:

| Place | Sells |
|---|---|
| Spar | AK-74 |
| Assorti | M4A1 carbine (holographic sight) |
| The corner shop at the end of the podium | Steyr AUG (1.5x scope) |
| ხილ ბოსტანი, the fruit shop by Gate 1 | Desert Eagle .50 AE |
| Nikora | TOZ-194 pump shotgun |
| Behind 2 Nabiji (Ori Nabiji) | the gunsmith: the gun in your hands to Mk II, III, IV (harder hits, more ammo) |
| 36.6 pharmacy | body armour I–IV (more health, less damage from every hit) |
| Format Fit | faster legs |
| TBC terminal | double points |
| Gate 2 security booth | SVD Dragunov |
| Gate 1 security booth | M60 machine gun |
| Crates by the stadium (middle courtyard) | compound bow; chainsaw (hold to cut, a few at once; runs on fuel, R refuels) |
| Cache on the twin tower roof (take the stairs) | FN SCAR 20S auto sniper |
| Cache on the next highest roof | Remington MSR (semi-automatic .338 sniper) |
| Crate down in the car park | RPG-7 mini-missile launcher (one in the tube, a quick reload; they burst on whatever they hit, or as they pass close by a zombie) |
| Crate down in the south car park (the ramp between Spar and Nikora) | Helios laser rifle, 7500 (hold the trigger: a beam that burns through two at once; no magazine, a battery that drains while it fires and charges itself back up) |
| Ammo crates: by the pool house (middle courtyard), at both gate booths, by the two other round courts, and down in each car park | ammo, fuel and grenades for everything (750) |
| Any gun shop or crate, for the gun you bought there | that gun filled up again (a fifth of its price, 150–600) |

Aim down the sights (E or right-click) and every gun hits twice as hard.

- Weapons behave like the real ones: recoil climbs and drifts, spread blooms when you hold the trigger, tactical reloads keep a round in the chamber, the shotgun loads shell by shell. Rifle rounds go through car bodies and through a zombie or two. Arrows drop with distance and stick where they land; walk over them to pick them up.
- Every parked car can be driven, and there are motorbikes and one-person drones around the complex. Cars and bikes run zombies down: a hit at speed throws them up over the bonnet, turning over, and they come down a few metres on with a thud; a slow one knocks them aside. You feel and hear each one (the bonnet, the body, a splat and bones going: recorded foley, and no death groan: they don't see it coming), and the bodies crunch under the wheels. Bodies stay where they fell while anyone can see them and go once no one's looking. They can still reach you through the door.
- Some cars are special: Tatia's blue Prius by Gate 1 (the plate says თათიას მანქანა), Beka's grey 2018 Civic next to it (ბექას მანქანა), the light-blue დაცვა security Leaf by the booth, and a green Lamborghini Huracán in the bay by the pool courtyard, which goes like nothing else in the complex.
- Power-ups sometimes drop from kills: Max Ammo, Insta-Kill, Double Points, Nuke.
- Falling more than a couple of storeys hurts. If you fall into a pool, walk out up the steps (by the chrome rails), or jump at any edge.

### Brain training

Puzzles for the mind between waves, and lari for doing them. They never get in the way: each is an
offer you can take or leave, and quick. On from the start; in **Settings**, **Brain training** sets
how often (every third wave, every wave, or off). Not in PvP matches.

- **After a wave** a small card offers a puzzle: one question (a sum, a matrix, a sudoku square, a
  chess position...). Press **B** or tap the card; leave it and it goes. **Puzzle crates** (violet,
  with a ?) round the complex hold one with two questions.
- **Fourteen kinds**, dealt in a shuffled round so each comes up before any comes again:
  - working memory: **dual n-back** (a square and a sound, n steps back) and **digit span** (digits
    typed back, in order or backwards)
  - speed: **useful field of view** (what flashed in the middle and where, the kind of speed training
    used in the ACTIVE study) and **reaction time** (simple, choice, go/no-go)
  - attention and control: **Stroop** (the ink's colour, not the word) and **visual search** (find
    the odd one out)
  - flexibility: **task switching** (sort by shape or by colour, as the cue says)
  - reasoning and logic: **matrix reasoning** (Raven-style pattern puzzles), **mini sudoku** (4x4 and
    6x6: which number goes in the marked square) and **chess tactics** (mate in one or two, real
    puzzles from Lichess)
  - spatial: **mental rotation** (the same shape turned, or its mirror image?)
  - memory: a **memory palace**, English words placed along a route through Green Diamond itself
  - calculation: **mental arithmetic**
  - vocabulary: a **mini crossword** in English, with Georgian clues
- **Each has a level of its own**, 1 to 10: a good round moves it up, a poor one down.
- **Nothing can hurt you while you're at a puzzle**, in any mode: alone, the game waits; in co-op the
  match goes on around you, but the zombies can't hurt you until you're done.
- **What it pays**: each question up to 300 lari at first, more as the waves get tougher, up to 600.
  Five good rounds running, a gun you haven't got (or a power-up if you have them all); every fifteen
  good rounds, the gun in your hands a level up for free.
- **My training** in Settings shows every puzzle's level and your best, and any of them can be played
  from there for practice (two questions). Progress stays in your browser.

### Graphics

The game picks Low, Medium or High from your GPU on the first run. You can change it in Settings (from the menu or the pause screen). It also lowers the render resolution by itself whenever the frame rate drops below about 50 fps, so it stays smooth on laptops, and raises it again only once it's been smooth for a while.

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
  - The twins: sage grey with cream bands.
  - Stage-3 blocks: vertical colour stripes.
  - Timber pergolas on the roofs.
- **Shops:** the real shops on the podium: Spar, Nikora, 2 Nabiji, 36.6, Format Fit, Assorti, ხილ ბოსტანი, TBC. The pavilions are
  white render with tall black-framed shopfronts and arched panels in the parapet, and each shop has its own sign: Spar's red
  band (სპარი), Nikora's maroon band with the bull and its billboard, the pharmacy's teal band, the Format Fit F. Matched to
  street-level photos and 360° photospheres of the complex.
- **Ground floors:** glazed lobby entrances under a black fascia with the block name as the real signs write it (ა ბლოკი
  A BLOCK), named from the developer's block map (B, CD1', CD2', E1', E2', F', A' and B' are provisional: the developer's
  names, until someone checks those signs); ground-floor flats with raised terraces, rails, screens and pergolas on the
  courtyard side.
- **The back by Gate 1:** the long shop strip with its curved window bays (the restaurant, კოუვ კაფე / Cove Cafe, the units
  for sale, Format Fit at the end) above a concrete retaining wall with a green mesh fence, a grass strip and the dirt road.
- **Gates:** the slatted portals with GATE 1 / GATE 2 on the beam, the security booths under their canopies with the Green
  Diamond sign, the barriers, and the blue diamond at Gate 1.
- **Underground parking:** the eight ramps from OpenStreetMap, starting at the kerb as the real ones do, lead down into the parking levels under the middle and northern courtyards. The ninth, between Spar and Nikora, runs down beside the pool court to the level under the south block (OpenStreetMap only has its walls; `tools/south_parking.py` adds it). The layout down there (aisles, stalls, columns) is a standard one, not surveyed.
- **Pool houses:** teal rendered rooms with an open timber veranda on the pool side under hipped roofs; the one by the sand court is a plain white pavilion.
- **Courts and courtyards:** three round terracotta courts with green chain-link fences and a triple hoop in the middle (the west end of the middle courtyard, its east end, and the north-west courtyard), the playground pads, gazebos, and the cabanas on the pool terrace, placed from satellite and aerial imagery and the developer's photos.
- **Surroundings:** across Bob Walsh Street, the sandy lot with the parked lorries (the TEXTAR one opposite Gate 1), the lawns, saplings and car park opposite Gate 2, the Ice Palace's rust-brown cladding and the arenas; the forest and construction sites to the west. Matched to the gates' photospheres. The hills around Tbilisi use real elevation data draped with Sentinel-2 imagery, and 900 real high-rises form the skyline.

## Project layout

```
index.html, src/          the game (ES modules, no build step)
  world/                  ground, buildings, props, sky, surroundings
  game/                   player, weapons, zombies, vehicles, stairs, pickups, pathfinding, waves, HUD, audio
  net/                    multiplayer: WebRTC links, session, network simulator, lobby and overlay
  train/                  brain training: the offer, the puzzle card, rewards; drills/ holds the puzzles (one module each, loaded when first played)
api/                      Vercel Functions for the multiplayer handshake (Vercel Blob storage)
cloudflare/               the same on Cloudflare: Worker + one Durable Object per room (wrangler.jsonc)
data/                     generated level, heightmap, terrain, skyline; words.json (English–Georgian words by level); chess.json (Lichess puzzles)
assets/                   models, textures, audio (see the CREDITS files)
tools/build_level.py      OSM -> data/level.json + heightmap (python3, shapely)
tools/fetch_backdrop.py   terrain, imagery, skyline downloads
tools/shot.mjs            headless screenshots (Playwright) for testing
tools/dev.mjs             local server with the multiplayer API (npm run dev)
tools/make_plates.py      Georgian number plates for the detailed cars
tools/words/              the English words (the crossword, the memory palace), a text file a level (word|part of speech|topic|Georgian|sentence|emoji);
                          python3 tools/words/build.py --out data/words.json checks them and writes the game's list
vendor/three/             three.js r186
vendor/chess.js/          chess.js 1.4 (BSD-2-Clause), for the chess puzzles
```

Debug URL flags: `?debug` (fps overlay), `?time=19.5`, `?wave=5`, `?god`,
`?nozombies`, `?quality=low`, `?cam=x,y,z,yaw,pitch`.

## Credits

- Map data © OpenStreetMap contributors (ODbL).
- Terrain: AWS Terrain Tiles.
- Imagery: Sentinel-2 cloudless 2024 by EOX IT Services (CC BY-NC-SA 4.0; personal, non-commercial use).
- 3D models by Quaternius, Kenney, J-Toastie, Rikindle3D, dogchicken, bachosoftdesign, Benjinsmith (zombie crow, CC-BY 3.0), mightydinosaurcol (M60, CC-BY 4.0), jeremy (motorbike, CC-BY 3.0), SirDraco65, Pichuliru, LonesomeDucky, AdamKokrito, Lucian Pavel, Teh_Bucket and others: see `assets/models/CREDITS.md`. The blue 2010 Toyota Prius is "Toyota Prius" by Isidor Goo (AirplaneChef, CC BY 4.0); the Nissan Leaf security car is built on Franz Albers' Nissan Leaf ZE0 (Apache-2.0) with the Prius wheels; Beka's grey 2018 Honda Civic is "Honda civic" by Aldios (CC BY 4.0); the green Lamborghini Huracán is "Lamborghini Huracan (2020)" by Kirigami (CC BY 4.0). The Steyr AUG is TastyTony's and the Remington MSR Kaan's (both CC BY 4.0); the chainsaw is loafbrr_1's and the RPG-7 Lucian Pavel's (both CC0). Your co-op teammates are Quaternius's SWAT survivor (CC0) with clips from his Universal Animation Library, plus rifle clips made for this project. The compound bow, arrow, personal drone and the Helios laser rifle were modelled for this project.
- Textures, sounds and HDRIs: see `assets/CREDITS_media.md`.
- Chess puzzles: the Lichess puzzle database (CC0). Chess pieces: Colin M. L. Burnett's set (BSD licence, via Wikimedia Commons). Chess rules: chess.js by Jeff Hlywa (BSD-2-Clause).
- Built with three.js.

This is a personal fan project. Green Diamond is a development by MAQRO Construction; the brands shown belong to their owners.
