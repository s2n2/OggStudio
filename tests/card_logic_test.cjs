// Checks OggStudio card logic without a browser: import conversion and share codes.
const fs = require('fs');
const assert = require('assert');
const path = require('path');

global.window = globalThis;
const src = fs.readFileSync(path.join(__dirname, '../custom_components/oggstudio/frontend/oggstudio-card.js'), 'utf8');
const grab = (start, end) => src.slice(src.indexOf(start), src.indexOf(end));
// eslint-disable-next-line no-eval
eval(grab('  const b64 =', '  // Stroke scripts') + grab('  function toIntensity', '  const duration ='));

// Card variants: each tag shows a valid subset of the parts, and every part needs a take box to save into.
{
  const { PARTS, VARIANTS } = eval(grab('  const PARTS =', '  const esc =') + '; ({ PARTS, VARIANTS })');
  assert.deepStrictEqual(Object.keys(VARIANTS), ['oggstudio-card', 'oggstudio-recorder-card', 'oggstudio-player-card', 'oggstudio-video-card']);
  assert.deepStrictEqual(VARIANTS['oggstudio-card'].parts, PARTS);
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
  const { GP_DEFAULT_MAP, GP_SPEEDS, GP_ACTIONS, gpDescribe, gpPressed, gpRaw } = eval(grab('  // Game controller.', '  const duration =') + '; ({ GP_DEFAULT_MAP, GP_SPEEDS, GP_ACTIONS, gpDescribe, gpPressed, gpRaw })');
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
  assert.ok(src.includes('id="gpon"') && src.includes('id="gplearnbtn"'), 'controller bar in the card');
}

const stroke = [{ at: 0, pos: 0 }, { at: 250, pos: 100 }, { at: 500, pos: 0 }, { at: 1500, pos: 50 }];
assert.deepStrictEqual(toIntensity(stroke, 'position').map((a) => a.pos), [0, 100, 0, 50]);
// 100 units in 0.25 s = full speed; 50 units in 1 s = 12.5%.
assert.deepStrictEqual(toIntensity(stroke, 'speed').map((a) => a.pos), [100, 100, 13, 0]);

const two = normalise({ actions: stroke, channels: { V1: { actions: [{ at: 0, pos: 30 }] } } }, 'position', false);
assert.deepStrictEqual(two.channels.V1.actions, [{ at: 0, pos: 30 }]);
assert.strictEqual(normalise({ actions: [{ at: 0, pos: 20 }] }, 'position', true).actions[0].pos, 80);
assert.throws(() => normalise({ actions: [] }, 'position', false));

// Device choice: remembered > configured > first connected (never an old, offline device).
{
  const flat = src.replace(/\r\n/g, '\n');
  const body = (name) => { const s = flat.indexOf(`    ${name}(`); assert.ok(s > 0, name); return flat.slice(flat.indexOf('{', s), flat.indexOf('\n    }\n', s) + 6); };
  const card = { _hass: { states: { 'binary_sensor.old': { state: 'off' }, 'binary_sensor.sync': { state: 'on' } } }, _config: {} };
  card._online = new Function('dev', body('_online'));
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
}

(async () => {
  const script = { version: '1.0', actions: [{ at: 0, pos: 10 }, { at: 100, pos: 90 }] };
  const code = await encodeCode(script);
  assert.ok(code.startsWith('ogg1:'));
  assert.deepStrictEqual(await decodeText(code), script);
  assert.deepStrictEqual(await decodeText(JSON.stringify(script)), script);
  console.log('OggStudio card logic passed (import conversion, share codes):', code.slice(0, 24) + '...');
})().catch((e) => { console.error(e); process.exit(1); });
