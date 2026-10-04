# Legwork

Four players, four legs, one very large machine. Each player is one leg of a tin-toy walker; together you carry a wobbling cargo across clay, ice, lava and clockwork without going over.

Play it at [onceworlds.com/play/legwork](https://onceworlds.com/play/legwork).

## How to play

A planted foot pushes the body where you aim; a foot trailing far behind its hip has no push left, so step it forward. A lifted foot flies where you aim and lands when you let go. The polygon between the planted feet is what holds you up: keep the weight dot inside it, or the machine starts to go over (slowly enough to catch it by putting a foot down). The stance gauge in the corner shows the machine from above, and a light on your foot says whether it can come up. Step on the beat with the others and the groove meter climbs (and the score and the music with it). Brace doubles a foot's grip for a second. Signals are quick calls the whole team hears. Each expedition allows six tumbles (the last, three).

Alone you are the pilot: the stick steers and three bot legs step for you. Hold Lift to take the highlighted foot yourself (Tab or the Leg button picks another), release to give it back. Leave the controls alone for five seconds and the bots walk the course on their own until you steer again. The Mechanic in the workshop makes the bots steadier.

### Keyboard

| Key | Action |
| --- | --- |
| W A S D or arrows | Aim the foot, push the body |
| Space (hold) | Lift; release to plant |
| Shift | Brace (1 s, 2 s cooldown) |
| Q (hold) | Signal wheel |
| 1-8 | Lift! Plant! Go! Wait! Left! Right! Help! Nice! |
| Tab | Next leg (pilot mode) |
| ← → | Pick an expedition (workshop) |
| R | Reset stance |
| [ ] / drag / wheel | Orbit and zoom the camera |
| Enter | Start (host) |

### Touch

The platform's thumbstick aims. Buttons: Lift (Take foot in pilot mode), Brace, Signal, Leg. Two fingers orbit the camera, which otherwise follows by itself.

## What is in it

- 24 expeditions across six biomes: Clay Flats, Salt Pans, Foundry, Ravine, Clockwork Hills, Storm Coast. The last one ends in The Great Stride.
- Surfaces: clay, ice, mud (feet sink), metal grates, springy pads, lava, chasms, moving platforms and gears, crumbling slabs, conveyors, tide-washed shores.
- Hazards on the clock: lava vents, steam pistons, falling rocks (shadow first), sweeping bars (lift the foot as it passes), timed gates (a green wave), rolling boulders, wind gusts, tides.
- Cargo: an egg, a soup tureen, lanterns, passengers, a boulder. Each tilts and spills differently; its condition is part of the score.
- Modes: Expedition (medals by time and cargo), Endless Stride (distance on one long escalating course), Daily (a seeded course with a mutator), and a ghost of your best run on any expedition.
- Mutators: Slippery, Gusty, Tiny Legs, Three Legs, Giant Cargo, No Bots, Back To Front.
- The workshop: scrap buys Feet (Claws grip ice, Pads keep out of the mud, Suction holds against gusts and slopes, Springs bounce a burned foot straight back), Hips, a Light or Heavy chassis, Cradles and Mechanics; paint, stickers, cargo hats and horns to show off.
- Medals by time and cargo, judged against teams of people in co-op and against the bots you steer in Pilot mode.
- Bots fill any leg without a player. They are deliberately clumsy at low skill and never make the game trivial.

## Multiplayer

A friends game: your own private server, up to four legs, friends arrive by invite. The host's page runs the simulation; everyone else sends their stick and buttons and draws the host's snapshots a tenth of a second behind. Seats, the run and a checkpoint of the whole walker live in room state, so a reload, a dropped connection or a change of host carries on from where things were, and anyone who arrives mid-run watches until the next checkpoint, then takes a bot's leg.

## How it is built

- `src/sim` is the whole game as plain data and pure functions: a seeded course builder with validation and repair, a kinematic constraint-based walker (no rigid-body engine), the cargo pendulum, hazards as functions of the clock, bots of three skills, simulated players for the balance harness (`humans.js`: reaction times, unsteady aim, nobody coordinating), scoring and the save schema. It runs in Node with no DOM.
- `src/render` draws it with three.js: a paper-cut height-field, an outlined tin walker with IK legs, pooled particles, the support polygon and targets, the chase camera.
- `src/net` is the room protocol (presence inputs, 20 Hz quantized views, 2 s checkpoints, admits), `src/app` the screens and the run loop, `src/audio` the procedural foley and the groove-driven waltz, `src/platform.js` the only file that talks to the SDK.
- Fonts (Bungee, Rubik) are bundled; there are no downloaded images, models or sounds.

## Running it locally

```
npm install
npm run dev        # the game on its own (a solo room, saves in localStorage)
npm test           # unit, property and fuzz tests for the simulation
npm run balance    # teams of simulated players of three skills, Pilot mode at each Mechanic level,
                   # the feet study and a pro-bot run of every course; prints the tables
npm run balance -- e6-4    # one expedition, every run listed (also: quick, solo, feet, bots, par)
npm run build && npm run store   # store art from the game's own poster scenes
npm run smoke      # the built game through its screens in headless Chrome
```

On Onceworlds the SDK is injected by the platform; to test with real multiplayer, deploy to a local platform with the Onceworlds CLI and open the play page in several guest windows.

## Badges

First Step, In Step, Four Legs Good, Nothing Spilled, Mud Lover, Ice Skater, Hot Foot, Tumble King, Solo Stride, Great Stride, Gold Rush.

## Leaderboards

`biome-1` to `biome-6` (your best times for a biome's four expeditions, added up), `endless-stride` (distance), `groove-best` (longest groove streak).

## License

MIT. See `LICENSE`.
