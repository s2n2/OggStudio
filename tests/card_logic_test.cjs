// Checks OggStudio card logic without a browser: import conversion and share codes.
const fs = require('fs');
const assert = require('assert');
const path = require('path');

global.window = globalThis;
const src = fs.readFileSync(path.join(__dirname, '../custom_components/oggstudio/frontend/oggstudio-card.js'), 'utf8');
const grab = (start, end) => src.slice(src.indexOf(start), src.indexOf(end));
// eslint-disable-next-line no-eval
eval(grab('  const b64 =', '  // Stroke scripts') + grab('  function toIntensity', '  const duration ='));

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
