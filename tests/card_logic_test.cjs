// Checks OggStudio card logic without a browser: import conversion and share codes.
const fs = require('fs');
const assert = require('assert');
const path = require('path');

global.window = globalThis;
const src = fs.readFileSync(path.join(__dirname, '../custom_components/oggstudio/frontend/oggstudio-card.js'), 'utf8');
const grab = (start, end) => src.slice(src.indexOf(start), src.indexOf(end));
// eslint-disable-next-line no-eval
const { isStroke, STROKE_SPEEDS, STROKE_LIMITS_RESET } = eval(grab('  const b64 =', '  // Run modes:') + grab('  // Run modes:', '  const duration =')
  + '; globalThis.toIntensity = toIntensity; ({ isStroke, STROKE_SPEEDS, STROKE_LIMITS_RESET })');

// Card variants: each tag shows a valid subset of the parts, and every part needs a take box to save into.
{
  const { PARTS, VARIANTS } = eval(grab('  const PARTS =', '  const esc =') + '; ({ PARTS, VARIANTS })');
  assert.deepStrictEqual(Object.keys(VARIANTS), ['oggstudio-card', 'oggstudio-recorder-card', 'oggstudio-player-card', 'oggstudio-video-card', 'oggstudio-stroke-card']);
  assert.deepStrictEqual(VARIANTS['oggstudio-card'].parts, PARTS.filter((p) => p !== 'stroke'), 'the full card stays as it was; the stroke recorder is its own card');
  assert.deepStrictEqual(VARIANTS['oggstudio-stroke-card'].parts, ['stroke', 'take']);
  for (const v of Object.values(VARIANTS)) {
    assert.ok(v.parts.every((p) => PARTS.includes(p)), v.name);
    assert.ok(v.parts.includes('take'), v.name + ' can save what it makes');
  }
  for (const p of PARTS) assert.ok(src.includes(`data-part="${p}"`), 'section for ' + p);
}

// Recording against a video: a later pass replaces earlier ones inside its span.
{
  const first = [{ at: 0, pos: 10 }, { at: 1000, pos: 20 }, { at: 2000, pos: 30 }, { at: 3000, pos: 40 }, { at: 4000, pos: 0 }];
  const redo = [{ at: 1500, pos: 90 }, { at: 2500, pos: 80 }];
  assert.deepStrictEqual(mergePasses([first, redo]).map((a) => a.at + ':' + a.pos),
    ['0:10', '1000:20', '1500:90', '2500:80', '3000:40', '4000:0']);
  // Pass recorded earlier in the video than the first one is just added in order.
  assert.deepStrictEqual(mergePasses([redo, [{ at: 100, pos: 5 }, { at: 200, pos: 6 }]]).map((a) => a.at), [100, 200, 1500, 2500]);
  assert.deepStrictEqual(mergePasses([[], first]).length, 5);
}

// Video sync: level at a video time, linear between actions.
{
  const acts = [{ at: 1000, pos: 0 }, { at: 2000, pos: 100 }, { at: 3000, pos: 40 }];
  assert.strictEqual(sampleAt(acts, 0), 0, 'silent before the first action');
  assert.strictEqual(sampleAt(acts, 1500), 50);
  assert.strictEqual(sampleAt(acts, 2000), 100);
  assert.strictEqual(sampleAt(acts, 2500), 70);
  assert.strictEqual(sampleAt(acts, 9000), 40, 'holds the last value');
  assert.strictEqual(sampleAt([], 100), 0);
  const many = Array.from({ length: 10000 }, (_, i) => ({ at: i * 10, pos: i % 101 }));
  assert.strictEqual(sampleAt(many, 55555), 0.5, 'binary search finds the right pair in long scripts');
}

// Game controller: bindings, held movement at a speed, learning and targets.
{
  const btn = (pressed) => ({ pressed, value: pressed ? 1 : 0 });
  const pad = (pressed = [], axes = [0, 0, 0, 0]) => ({ buttons: Array.from({ length: 17 }, (_, i) => btn(pressed.includes(i))), axes });
  const keys = new Set();
  const { GP_DEFAULT_MAP, GP_SPEEDS, GP_ACTIONS, gpDescribe, gpPressed, gpRaw, ST_ACTIONS, ST_DEFAULT_MAP, GP_PROFILES } = eval(grab('  // Game controller.', '  const duration =') + '; ({ GP_DEFAULT_MAP, GP_SPEEDS, GP_ACTIONS, gpDescribe, gpPressed, gpRaw, ST_ACTIONS, ST_DEFAULT_MAP, GP_PROFILES })');
  // Standard D-pad buttons, an analog stick (proportional, with dead zone) and keyboard mode.
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, pad([12]), keys).up, 1);
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, pad([0]), keys).rec, 1);
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, pad([], [0, -1]), keys).up, 1);
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, pad([], [0, 1]), keys).up, 0);
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, pad([], [0, -0.2]), keys).up, 0, 'stick drift is ignored');
  assert.ok(Math.abs(gpRead(GP_DEFAULT_MAP, pad([], [0, -0.625]), keys).up - 0.5) < 1e-9, 'half-way push = half speed');
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, null, new Set(['ArrowLeft'])).left, 1, 'keyboard-mode controllers work with no gamepad');
  assert.strictEqual(gpRead(GP_DEFAULT_MAP, null, keys).up, 0);
  // Held up at 100 %/s for 100 ms = +10; never past 0..100; a stall frame is capped.
  assert.strictEqual(gpStep(50, 1, 0, 100, 100), 60);
  assert.strictEqual(gpStep(50, 0, 1, 100, 100), 40);
  assert.strictEqual(gpStep(95, 1, 0, 300, 100), 100);
  assert.strictEqual(gpStep(3, 0, 1, 300, 100), 0);
  assert.strictEqual(gpStep(50, 1, 0, 100, 5000), 60, 'a long frame gap moves at most 100 ms worth');
  let level = 0;
  for (let i = 0; i < 60; i++) level = gpStep(level, 1, 0, 60, 1000 / 60);
  assert.ok(Math.abs(level - 60) < 1e-6, 'small per-frame steps add up (no rounding loss)');
  assert.ok(GP_SPEEDS.every((s, i) => i === 0 || s > GP_SPEEDS[i - 1]), 'speeds go up');
  // Learning: hands-off calibration measures rest and jitter per axis.
  const noisy = Array.from({ length: 40 }, (_, i) => [0.01 * (i % 3), -1, 0.5 + (i % 2 ? 0.2 : -0.2), 3.29]);
  const cal = gpCalibrate(noisy);
  assert.ok(Math.abs(cal.rest[2] - 0.5) < 1e-9 && Math.abs(cal.noise[2] - 0.2) < 1e-9, 'jittery axis: rest 0.5, jitter 0.2');
  assert.strictEqual(cal.rest[1], -1);
  // Holding nothing: jitter, a trigger at rest and an idle hat are not inputs.
  assert.strictEqual(gpPickInput(pad([], [0.02, -1, 0.68, 3.29]), cal, 0), null, 'jitter inside its band is ignored');
  // The confirm (Record) button itself is never the answer; another button is.
  assert.strictEqual(gpPickInput(pad([0], [0, -1, 0.5, 3.29]), cal, 0), null);
  assert.deepStrictEqual(gpPickInput(pad([0, 5], [0, -1, 0.5, 3.29]), cal, 0), { b: 5 });
  // A stick pushed: direction from its rest point.
  assert.deepStrictEqual(gpPickInput(pad([0], [-0.9, -1, 0.5, 3.29]), cal, 0), { a: 0, d: -1 });
  // A jittery axis needs a big move, and keeps its rest point and a wider dead zone.
  assert.strictEqual(gpPickInput(pad([0], [0, -1, 0.95, 3.29]), cal, 0), null, 'move smaller than 2x jitter + 0.2');
  assert.deepStrictEqual(gpPickInput(pad([0], [0, -1, -0.6, 3.29]), cal, 0), { a: 2, d: -1, r: 0.5, z: 0.3 });
  // Hat switch (rests at 3.29, one value per direction): binds to the value.
  assert.deepStrictEqual(gpPickInput(pad([0], [0, -1, 0.5, -1]), cal, 0), { a: 3, v: -1 });
  assert.deepStrictEqual(gpPickInput(pad([0], [0, 0.95, 0.5, 0.14]), cal, 0), { a: 3, v: 0.14 }, 'furthest beyond its threshold wins');
  const hatUp = { up: [{ a: 3, v: -1 }], down: [{ a: 3, v: 0.14 }] };
  assert.strictEqual(gpRead(hatUp, pad([], [0, 0, 0, -1]), keys).up, 1);
  assert.strictEqual(gpRead(hatUp, pad([], [0, 0, 0, -1]), keys).down, 0);
  assert.strictEqual(gpRead(hatUp, pad([], [0, 0, 0, 3.29]), keys).up, 0, 'idle hat is nothing');
  assert.strictEqual(gpRead(hatUp, pad([], [0, 0, 0, 0.14]), keys).down, 1);
  // Off-centre axis with its rest point: still at rest = 0, pushed = pressed.
  const off = { down: [{ a: 2, d: -1, r: 0.5, z: 0.3 }] };
  assert.strictEqual(gpRead(off, pad([], [0, 0, 0.6]), keys).down, 0);
  assert.strictEqual(gpRead(off, pad([], [0, 0, -0.5]), keys).down, 1);
  assert.strictEqual(gpFirstButton(pad([4, 9]), 4), 9);
  assert.strictEqual(gpFirstButton(pad()), -1);
  // A button that reads as pressed all the time is ignored, for picking and for Record.
  assert.strictEqual(gpFirstButton(pad([2, 7]), -1, [2]), 7);
  assert.strictEqual(gpFirstButton(pad([2]), -1, [2]), -1);
  const stuckCal = { ...cal, stuck: [2] };
  assert.strictEqual(gpPickInput(pad([0, 2], [0, -1, 0.5, 3.29]), stuckCal, 0), null, 'stuck button is not an input');
  assert.deepStrictEqual(gpPickInput(pad([0, 2, 6], [0, -1, 0.5, 3.29]), stuckCal, 0), { b: 6 });
  assert.deepStrictEqual(gpPressed(pad([1, 4])), [1, 4]);
  // Several gamepads (Android lists extra devices): the last one pressed wins,
  // else a standard-mapped one, else the one with the most buttons.
  const phantom = { index: 0, connected: true, mapping: '', id: 'uinput-fpc', buttons: [btn(false)], axes: [] };
  const real = { ...pad(), index: 1, connected: true, mapping: '', id: 'Generic BT' };
  const std = { ...pad(), index: 2, connected: true, mapping: 'standard', id: 'Std' };
  assert.strictEqual(gpChoosePad([phantom, real], undefined).index, 1, 'more buttons beats a phantom device');
  assert.strictEqual(gpChoosePad([phantom, real, std], undefined).index, 2);
  assert.strictEqual(gpChoosePad([phantom, real, std], 1).index, 1, 'last pressed wins');
  assert.strictEqual(gpChoosePad([null, undefined], undefined), null);
  assert.ok(gpRaw({ ...real, buttons: pad([3]).buttons, axes: [0.123, -1] }).includes('pressed [3] · axes 0:0.12 1:-1.00'));
  assert.strictEqual(gpDescribe({ a: 3, v: -1 }), 'hat axis 3 at -1');
  assert.strictEqual(gpDescribe(null), 'default');
  const map = gpBuildMap({ rec: [{ b: 3 }], up: [{ a: 9, d: -1 }] });
  assert.deepStrictEqual(map.rec, [{ b: 3 }, { k: 'Enter' }, { k: 'MediaPlayPause' }]);
  assert.deepStrictEqual(map.up, [{ a: 9, d: -1 }, { k: 'ArrowUp' }], 'learned action: what was learned, plus its keyboard keys');
  assert.deepStrictEqual(map.motor, [], 'a default that clashes with a learned control is dropped');
  assert.deepStrictEqual(map.down, [{ b: 13 }, { k: 'ArrowDown' }], 'skipped action keeps defaults but not stick axes');
  assert.deepStrictEqual(gpBuildMap({}).down, GP_DEFAULT_MAP.down, 'nothing learned = full defaults');
  assert.deepStrictEqual(Object.keys(map), GP_ACTIONS);
  // Target: video recording when this card has a video loaded, else the pads.
  assert.strictEqual(gpTargetFor(['record', 'take', 'library', 'video', 'import'], true), 'video');
  assert.strictEqual(gpTargetFor(['record', 'take', 'library', 'video', 'import'], false), 'record');
  assert.strictEqual(gpTargetFor(['video', 'take'], false), null);
  assert.strictEqual(gpTargetFor(['library', 'take', 'import'], true), null);
  assert.strictEqual(gpTargetFor(['stroke', 'take'], false), 'stroke');
  // Stroke profile: its own actions and defaults, built the same way.
  const smap = gpBuildMap({ rec: [{ b: 5 }], fast: [{ a: 9, v: 0.71 }] }, ST_DEFAULT_MAP);
  assert.deepStrictEqual(Object.keys(smap), ST_ACTIONS);
  assert.deepStrictEqual(smap.fast, [{ a: 9, v: 0.71 }, { k: 'ArrowRight' }]);
  assert.deepStrictEqual(smap.rec, [{ b: 5 }, { k: 'Enter' }, { k: 'MediaPlayPause' }]);
  assert.strictEqual(gpRead(smap, pad([], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.71]), keys).fast, 1);
  assert.strictEqual(gpRead(ST_DEFAULT_MAP, pad([1]), keys).reset, 1);
  assert.deepStrictEqual(Object.keys(gpRead(ST_DEFAULT_MAP, null, keys)), ST_ACTIONS);
  assert.deepStrictEqual(GP_PROFILES.stroke.hold, ST_ACTIONS.filter((a) => a !== 'rec'));
  assert.notStrictEqual(GP_PROFILES.stroke.mapKey, GP_PROFILES.level.mapKey, 'each card type learns its own controls');
  assert.ok(src.includes('id="gpon"') && src.includes('id="gplearnbtn"'), 'controller bar in the card');
}

const stroke = [{ at: 0, pos: 0 }, { at: 250, pos: 100 }, { at: 500, pos: 0 }, { at: 1500, pos: 50 }];
const flat = (acts) => acts.map((a) => `${a.at}:${a.pos}`).join(' ');
assert.deepStrictEqual(toIntensity(stroke, 'position').map((a) => a.pos), [0, 100, 0, 50]);
// 100 units in 0.25 s = full speed; 50 units in 1 s = 12.5%. Each move holds its level.
assert.strictEqual(flat(toIntensity(stroke, 'speed')), '0:100 249:100 250:100 499:100 500:13 1499:13 1500:0');
// Downstrokes only: the up moves are silent, and the reverse.
assert.strictEqual(flat(toIntensity(stroke, 'down')), '0:0 249:0 250:100 499:100 500:0 1499:0 1500:0');
assert.strictEqual(flat(toIntensity(stroke, 'up')), '0:100 249:100 250:0 499:0 500:13 1499:13 1500:0');
// Combined: speed first, position fills 35% of the headroom; full speed stays 100.
assert.strictEqual(moveIntensity('combo', 0, 100, 250), 100);
assert.strictEqual(moveIntensity('combo', 100, 100, 1000), 35, 'a hold at the top still registers');
assert.strictEqual(moveIntensity('combo', 0, 0, 1000), 0);
assert.strictEqual(Math.round(moveIntensity('combo', 40, 60, 1000)), 22, '5% speed + 35% of 95 headroom at 50');
assert.ok(moveIntensity('combo', 80, 90, 500) > moveIntensity('combo', 10, 20, 500), 'higher = stronger at the same speed');
assert.ok(moveIntensity('combo', 10, 30, 200) > moveIntensity('combo', 10, 30, 800), 'faster = stronger at the same place');
// Live: velocity in %/s; 400 %/s = full.
assert.strictEqual(liveIntensity('speed', 50, -400), 100);
assert.strictEqual(liveIntensity('down', 50, 200), 0);
assert.strictEqual(liveIntensity('down', 50, -200), 50);
assert.strictEqual(liveIntensity('position', 70, 0), 70);

// Import: stroke scripts are kept as positions and marked; vibration as they are.
const two = normalise({ actions: stroke, channels: { V1: { actions: [{ at: 0, pos: 30 }] } } }, 'vibration', false);
assert.deepStrictEqual(two.channels.V1.actions, [{ at: 0, pos: 30 }]);
assert.strictEqual(normalise({ actions: [{ at: 0, pos: 20 }] }, 'vibration', true).actions[0].pos, 80);
assert.throws(() => normalise({ actions: [] }, 'vibration', false));
assert.strictEqual(normalise({ actions: stroke }, 'auto', false).metadata.type, 'stroke', 'unmarked funscripts are stroke scripts');
assert.strictEqual(normalise({ actions: stroke, metadata: { type: 'vibration' } }, 'auto', false).metadata.type, 'vibration');
const raw = normalise({ actions: stroke }, 'stroke', false);
assert.ok(isStroke(raw) && flat(raw.actions) === flat(stroke));
const run = runScript(raw, 'speed');
assert.strictEqual(run.metadata.type, 'vibration');
assert.strictEqual(flat(run.actions), flat(toIntensity(stroke, 'speed')));
assert.strictEqual(runScript(two, 'speed'), two, 'vibration scripts play unchanged');

// Stroke recorder: holding a speed strokes between the limits.
{
  // Speed is device speed: 100% = 400 units/s, whatever the range.
  const V = (pct) => pct / 100 * 400 / 1000;
  let r = strokeStep(20, 1, 20, 80, V(50), 60);
  assert.ok(Math.abs(r.pos - 32) < 1e-9 && r.dir === 1 && !r.turns.length, '50% = 200 units/s = 12 units in 60 ms');
  const short = strokeStep(40, 1, 40, 60, V(100), 20), long = strokeStep(0, 1, 0, 100, V(100), 20);
  assert.strictEqual(short.pos - 40, long.pos - 0, 'same speed on a short range as on the full range');
  r = strokeStep(75, 1, 20, 80, V(100), 25);   // 10 units: 5 up to the limit, 5 back down
  assert.ok(Math.abs(r.pos - 75) < 1e-9 && r.dir === -1);
  assert.strictEqual(r.turns.length, 1);
  assert.strictEqual(r.turns[0].pos, 80);
  assert.ok(Math.abs(r.turns[0].frac - 0.5) < 1e-9, 'turn half way through the tick');
  // A 20-wide range at 100%: up and back (40 units) in 100 ms; the full range takes 500 ms.
  let pos = 40, dir = 1; const turns = [];
  for (let i = 0; i < 5; i++) { r = strokeStep(pos, dir, 40, 60, V(100), 20); pos = r.pos; dir = r.dir; turns.push(...r.turns.map((t) => t.pos)); }
  assert.ok(Math.abs(pos - 40) < 1e-6, 'short range: shorter cycle, not slower movement');
  assert.deepStrictEqual(turns, [60, 40]);
  // Outside the range it heads in and then strokes.
  r = strokeStep(95, 1, 20, 80, V(50), 45);
  assert.ok(r.pos < 95 && r.dir === -1, 'above the range: comes down');
  r = strokeStep(5, -1, 20, 80, V(50), 20);
  assert.ok(r.pos > 5 && r.dir === 1);
  assert.deepStrictEqual(strokeStep(50, 1, 50, 50, V(50), 20), { pos: 50, dir: 1, turns: [] }, 'no range: no movement');
  assert.strictEqual(strokeStep(20, 1, 20, 80, V(30), 5000).pos, strokeStep(20, 1, 20, 80, V(30), 100).pos, 'a long timer gap moves at most 100 ms worth');
  assert.ok(STROKE_SPEEDS.every((x, i) => i === 0 || x.pct > STROKE_SPEEDS[i - 1].pct), 'slow, medium, fast');

  // Set limit pairs with the limit set before it; the first replaces the nearer end.
  let lim = { ...STROKE_LIMITS_RESET };
  lim = strokeSetLimit(lim, 30);
  assert.deepStrictEqual(lim, { lower: 30, upper: 100, last: 'lower' });
  lim = strokeSetLimit(lim, 70.4);
  assert.deepStrictEqual(lim, { lower: 30, upper: 70, last: 'upper' }, 'above the other limit = upper');
  assert.deepStrictEqual(strokeSetLimit(lim, 50), { lower: 50, upper: 70, last: 'lower' }, 'below the last limit = lower');
  assert.deepStrictEqual(strokeSetLimit({ lower: 30, upper: 70, last: 'lower' }, 10), { lower: 10, upper: 30, last: 'lower' });
  assert.deepStrictEqual(strokeSetLimit({ ...STROKE_LIMITS_RESET }, 80), { lower: 0, upper: 80, last: 'upper' });
  assert.strictEqual(strokeSetLimit(lim, 71), null, 'on top of the other limit: refused');

  // Range rail: grab a limit near it, the band in the middle, the nearer limit outside.
  const L = { lower: 30, upper: 70 };
  assert.deepStrictEqual(railGrab(L, 72, 5), { mode: 'upper' });
  assert.deepStrictEqual(railGrab(L, 27, 5), { mode: 'lower' });
  assert.deepStrictEqual(railGrab(L, 50, 5), { mode: 'move', off: 20 });
  assert.deepStrictEqual(railGrab(L, 90, 5), { mode: 'upper' });
  assert.deepStrictEqual(railGrab(L, 5, 5), { mode: 'lower' });
  assert.deepStrictEqual(railGrab({ lower: 48, upper: 52 }, 50.5, 5), { mode: 'upper' }, 'narrow range: the nearer limit');
  assert.deepStrictEqual(railDrag(L, { mode: 'upper' }, 85.4), { lower: 30, upper: 85 });
  assert.deepStrictEqual(railDrag(L, { mode: 'upper' }, 10), { lower: 30, upper: 32 }, 'upper never goes below lower');
  assert.deepStrictEqual(railDrag(L, { mode: 'lower' }, 99), { lower: 68, upper: 70 });
  assert.deepStrictEqual(railDrag(L, { mode: 'move', off: 20 }, 60), { lower: 40, upper: 80 }, 'whole range moves, same width');
  assert.deepStrictEqual(railDrag(L, { mode: 'move', off: 20 }, 99), { lower: 60, upper: 100 }, 'stops at the top');
  assert.deepStrictEqual(railDrag(L, { mode: 'move', off: 20 }, -5), { lower: 0, upper: 40 }, 'stops at the bottom');

  // First touch on the position bar: no faster than the last speed, then it follows the finger.
  let a = approachStep(0, 100, V(30), 20);
  assert.ok(Math.abs(a.pos - 2.4) < 1e-9 && !a.caught, '30%: 2.4 units per 20 ms');
  assert.ok(Math.abs(approachStep(0, 100, V(100), 20).pos - 8) < 1e-9, '100%: 8 units per 20 ms');
  assert.deepStrictEqual(approachStep(49, 50, V(30), 20), { pos: 50, caught: true }, 'close enough: caught');
  let p2 = 0, t = 0, caught = false;
  while (!caught && t < 5000) { const q = approachStep(p2, 100, V(30), 20); p2 = q.pos; caught = q.caught; t += 20; }
  assert.ok(t >= 820 && t <= 860, 'a full-range jump at 30% takes about 0.83 s, not an instant');
}

// Device choice: remembered > configured > first connected (never an old, offline device).
{
  const flat = src.replace(/\r\n/g, '\n');
  const body = (name) => { const s = flat.indexOf(`    ${name}(`); assert.ok(s > 0, name); return flat.slice(flat.indexOf('{', s), flat.indexOf('\n    }\n', s) + 6); };
  const card = { _hass: { states: { 'binary_sensor.old': { state: 'off' }, 'binary_sensor.sync': { state: 'on' } } }, _config: {} };
  card._online = new Function('dev', body('_online'));
  global.NO_DEVICE = 'none';
  card._pickDevice = new Function(body('_pickDevice'));
  card._devices = [
    { id: 'a', name: 'Aardvark (old)', connected: 'binary_sensor.old' },
    { id: 's', name: 'Sync 2', connected: 'binary_sensor.sync' },
    { id: 'b', name: 'Bond', connected: 'binary_sensor.old' },
  ];
  assert.strictEqual(card._pickDevice(), 's', 'defaults to a connected device');
  card._remembered = { id: 'b', name: 'Bond' };
  assert.strictEqual(card._pickDevice(), 'b', 'remembered choice wins even while offline');
  card._remembered = { id: 'gone', name: 'Sync 2' };
  assert.strictEqual(card._pickDevice(), 's', 're-paired device found by name');
  card._remembered = null; card._config = { device: 'Bond' };
  assert.strictEqual(card._pickDevice(), 'b', 'configured device used when nothing remembered');
  card._deviceId = 'a';
  assert.strictEqual(card._pickDevice(), 'a', 'current selection kept');
  card._deviceId = 'none';
  assert.strictEqual(card._pickDevice(), 'none', 'No device stays chosen');
  card._deviceId = null; card._remembered = { id: 'none', name: '' };
  assert.strictEqual(card._pickDevice(), 'none', 'No device is remembered');
  card._remembered = null; card._config = {}; card._devices = []; card._deviceId = null;
  assert.strictEqual(card._pickDevice(), undefined, 'device list not loaded yet: wait');
  card._registryDone = true;
  assert.strictEqual(card._pickDevice(), 'none', 'no Ogg devices at all: No device');
}

(async () => {
  const script = { version: '1.0', actions: [{ at: 0, pos: 10 }, { at: 100, pos: 90 }] };
  const code = await encodeCode(script);
  assert.ok(code.startsWith('ogg1:'));
  assert.deepStrictEqual(await decodeText(code), script);
  assert.deepStrictEqual(await decodeText(JSON.stringify(script)), script);
  console.log('OggStudio card logic passed (import conversion, share codes):', code.slice(0, 24) + '...');
})().catch((e) => { console.error(e); process.exit(1); });
