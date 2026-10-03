// Every number the simulation uses. Tuned against scripts/balance.mjs.

export const DT = 1 / 60;

// Chassis and legs (metres, seconds).
export const CHASSIS_L = 4.4;
export const CHASSIS_W = 3.0;
export const HIP_H = 2.1;
export const THIGH = 2.2;
export const SHIN = 2.6;
export const L_MIN = 1.0;
export const L_MAX = 3.4;
export const SWING_T = 0.28;
export const SWING_ARC = 0.8;
export const HOVER_H = 0.35;
export const NEUTRAL_R = 2.2;
export const BELLY_H = 0.9;

// Hips in the body frame: [forward, right]. Order: front-left, front-right, rear-left, rear-right.
export const HIPS = [
  [CHASSIS_L / 2, -CHASSIS_W / 2],
  [CHASSIS_L / 2, CHASSIS_W / 2],
  [-CHASSIS_L / 2, -CHASSIS_W / 2],
  [-CHASSIS_L / 2, CHASSIS_W / 2],
];
export const LEG_NAMES = ['Front left', 'Front right', 'Rear left', 'Rear right'];
export const LEG_COLORS = ['#f0702a', '#22a0a0', '#f2c53d', '#f07aa8'];
export const LEG_MARKS = ['circle', 'square', 'triangle', 'star'];

// Body motion.
export const PUSH_GAIN = 2.6; // four full pushes on clay: 2.6 m/s
export const YAW_GAIN = 0.9; // rad/s per unit moment
export const VEL_DAMP = 3.5; // 1/s
export const YAW_DAMP = 5;
export const HEIGHT_K = 40;
export const HEIGHT_C = 11;
export const TILT_EASE = 9;
export const SAG = [0, 0, 0.3, 0, 0]; // by planted count (0 and 1 are special-cased)
export const SAG_ANGLE = [0, 0.16, 0.1, 0, 0]; // radians, by planted count
export const SLOPE_FORCE = 2.2; // m/s per unit gradient on frictionless feet
export const WIND_GAIN = 1;

// Balance.
export const COM_MARGIN = 0.5;
export const TIP_RATE = 34; // degrees per second per metre outside the margin
export const TIP_RECOVER = 48; // degrees per second
export const TIP_LIMIT = 28;
export const TUMBLE_T = 3;
export const TIP_COM_LEAN = 0.012; // metres of extra COM offset per degree of tip

// Grip and slipping.
export const BRACE_T = 1;
export const BRACE_CD = 2;
export const BRACE_MULT = 2;
export const SLIDE_RATE = 1.2; // m/s of foot slide per unit push on frictionless ground
export const MUD_SINK_RATE = 0.15; // reach lost per second planted in mud
export const MUD_POP_REACH = L_MIN + 0.4;
export const SPRING_DELAY = 0.22;
export const SPRING_HOP = 3.2;
export const SPRING_FLY = 0.5;
export const BURN_STUN = 1.5;
export const HIT_STUN = 1;
export const CRUMBLE_T = 2.6; // a slab cracks on the first plant and drops this long after
export const CRUMBLE_REGROW = 3;
export const CONVEYOR_SPEED = 1.1;

// Surfaces.
export const S = { CLAY: 0, ICE: 1, MUD: 2, GRATE: 3, SPRING: 4, LAVA: 5, VOID: 6, PLATFORM: 7, CRUMBLE: 8, CONVEYOR: 9, SHORE: 10, STONE: 11 };
export const SURFACES = [
  { id: 'clay', grip: 1.0, sound: 'clay', safe: true },
  { id: 'ice', grip: 0.25, sound: 'ice', safe: true },
  { id: 'mud', grip: 0.6, sound: 'mud', safe: true, sink: true },
  { id: 'grate', grip: 1.1, sound: 'metal', safe: true },
  { id: 'spring', grip: 1.0, sound: 'spring', safe: true },
  { id: 'lava', grip: 0, sound: 'burn', safe: false, deadly: true },
  { id: 'void', grip: 0, sound: 'fall', safe: false, deadly: true },
  { id: 'platform', grip: 1.0, sound: 'metal', safe: true },
  { id: 'crumble', grip: 1.0, sound: 'stone', safe: true, crumbles: true },
  { id: 'conveyor', grip: 1.0, sound: 'metal', safe: true },
  { id: 'shore', grip: 0.9, sound: 'clay', safe: true, wetGrip: 0.35 },
  { id: 'stone', grip: 1.0, sound: 'stone', safe: true },
];

// Cargo.
export const CARGO = {
  egg: { name: 'Egg', limit: 18, mass: 0.25, height: 1.4, loss: 0.5, mode: 'crack' },
  soup: { name: 'Soup', limit: 10, mass: 0.3, height: 1.2, loss: 0.14, mode: 'slosh' },
  lanterns: { name: 'Lanterns', limit: 22, mass: 0.15, height: 1.8, loss: 0.2, mode: 'drop' },
  passengers: { name: 'Passengers', limit: 25, mass: 0.35, height: 1.5, loss: 0.25, mode: 'drop' },
  boulder: { name: 'Boulder', limit: 40, mass: 0.7, height: 1.3, loss: 0.08, mode: 'shift' },
};
export const CARGO_K = 40; // the cradle levels the cargo against the world
export const CARGO_C = 6; // damping (the cradle upgrade multiplies it)
export const CARGO_LEAN = 0.03; // radians per m/s^2 of body acceleration
export const CARGO_INSTAB = 1.6; // 1/s^2: tilts grow unless corrected
export const SPILL_COOLDOWN = 1.5;

// Upgrades (the workshop). Costs in scrap.
export const FEET = {
  std: { name: 'Rubber', cost: 0 },
  claws: { name: 'Claws', cost: 120, iceGrip: 0.65 },
  pads: { name: 'Pads', cost: 120, sinkMult: 0.35 },
  suction: { name: 'Suction', cost: 140, slopeMult: 0.25, windMult: 0.6 },
  springs: { name: 'Springs', cost: 160, swingMult: 0.72, hoverBounce: true },
};
export const HIPS_LEVELS = [
  { name: 'Standard', cost: 0, reach: 0 },
  { name: 'Long', cost: 150, reach: 0.3 },
  { name: 'Extra long', cost: 260, reach: 0.6 },
];
export const CHASSIS = {
  std: { name: 'Standard', cost: 0, gain: 1, tip: 1, damp: 1 },
  light: { name: 'Light', cost: 180, gain: 1.2, tip: 1.3, damp: 0.8 },
  heavy: { name: 'Heavy', cost: 180, gain: 0.85, tip: 0.7, damp: 1.5 },
};
export const CRADLE_LEVELS = [
  { name: 'None', cost: 0, damp: 1 },
  { name: 'Cradle I', cost: 100, damp: 1.6 },
  { name: 'Cradle II', cost: 180, damp: 2.3 },
  { name: 'Cradle III', cost: 280, damp: 3.2 },
];
export const MECHANIC_LEVELS = [
  { name: 'Apprentice', cost: 0, skill: 0 },
  { name: 'Journeyman', cost: 140, skill: 1 },
  { name: 'Master', cost: 320, skill: 2 },
];

// Expeditions.
export const TUMBLE_BUDGET = 8;
export const ENDLESS_BUDGET = 6;
export const CHECKPOINT_EVERY = 55; // metres (about 40 s)

export const SIGNALS = ['Lift!', 'Plant!', 'Go!', 'Wait!', 'Left!', 'Right!', 'Help!', 'Nice!'];
export const SIGNAL_KEYS = ['lift', 'plant', 'go', 'wait', 'left', 'right', 'help', 'nice'];
