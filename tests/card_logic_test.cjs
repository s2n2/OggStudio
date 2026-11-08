// Checks OggStudio card logic without a browser: import conversion and share codes.
const fs = require('fs');
const assert = require('assert');
const path = require('path');

global.window = globalThis;
const src = fs.readFileSync(path.join(__dirname, '../custom_components/oggstudio/frontend/oggstudio-card.js'), 'utf8');
const grab = (start, end) => src.slice(src.indexOf(start), src.indexOf(end));
// eslint-disable-next-line no-eval
eval(grab('  const b64 =', '  // Stroke scripts') + grab('  function toIntensity', '  const duration ='));

const stroke = [{ at: 0, pos: 0 }, { at: 250, pos: 100 }, { at: 500, pos: 0 }, { at: 1500, pos: 50 }];
assert.deepStrictEqual(toIntensity(stroke, 'position').map((a) => a.pos), [0, 100, 0, 50]);
// 100 units in 0.25 s = full speed; 50 units in 1 s = 12.5%.
assert.deepStrictEqual(toIntensity(stroke, 'speed').map((a) => a.pos), [100, 100, 13, 0]);

const two = normalise({ actions: stroke, channels: { V1: { actions: [{ at: 0, pos: 30 }] } } }, 'position', false);
assert.deepStrictEqual(two.channels.V1.actions, [{ at: 0, pos: 30 }]);
assert.strictEqual(normalise({ actions: [{ at: 0, pos: 20 }] }, 'position', true).actions[0].pos, 80);
assert.throws(() => normalise({ actions: [] }, 'position', false));

(async () => {
  const script = { version: '1.0', actions: [{ at: 0, pos: 10 }, { at: 100, pos: 90 }] };
  const code = await encodeCode(script);
  assert.ok(code.startsWith('ogg1:'));
  assert.deepStrictEqual(await decodeText(code), script);
  assert.deepStrictEqual(await decodeText(JSON.stringify(script)), script);
  console.log('OggStudio card logic passed (import conversion, share codes):', code.slice(0, 24) + '...');
})().catch((e) => { console.error(e); process.exit(1); });
