// Checks limits, script tools and audio feel without a browser.
import assert from 'assert';
import * as lib from '../frontend/src/lib/index.js';

const { limitsFor, isLimited, limitLevels, limitMove, limitsText, heatmap, heatColor, trimScript, loopScript, stitchScripts, duration, AudioFeel } = lib;

// ---- limits
const none = limitsFor({}, 'button.a_stop');
assert.deepStrictEqual(none, { max: 100, lo: 0, hi: 100, speed: 100 });
assert.strictEqual(isLimited(none), false);
assert.strictEqual(limitsText(none), '');
const lim = limitsFor({ 'button.a_stop': { max: 60, lo: 20, hi: 80, speed: 50 } }, 'button.a_stop');
assert.strictEqual(isLimited(lim), true);
assert.deepStrictEqual(limitLevels(lim, [100, 50, 150, -5]), [60, 30, 60, 0]);
assert.deepStrictEqual(limitLevels(none, [100, 37]), [100, 37]);
// A move stays inside the range, however far it asks to go.
for (const goal of [0, 25, 100, 300, -40]) {
  const m = limitMove(lim, { goal, dur: 10 }, 50);
  assert.ok(m.goal >= 20 && m.goal <= 80, `goal ${goal} -> ${m.goal}`);
  // ...and never faster than the top speed (200 units/s at 50%).
  assert.ok(Math.abs(m.goal - 50) / m.dur * 1000 <= 200.001 || m.goal === 50, `speed for ${goal}`);
}
assert.deepStrictEqual(limitMove(none, { goal: 70, dur: 120 }, 10), { goal: 70, dur: 120 });
// Unknown start: assume the far end, so the first move is not a lunge.
assert.strictEqual(limitMove(lim, { goal: 100, dur: 1 }, null).dur, 300);
assert.strictEqual(limitsText(lim), 'top 60% · range 20-80% · speed 50%');

// ---- script tools
const vib = { actions: [{ at: 0, pos: 0 }, { at: 1000, pos: 100 }, { at: 2000, pos: 0 }] };
const heat = heatmap(vib, 4);
assert.strictEqual(heat.length, 4);
assert.ok(heat[1] > heat[0] && heat[2] > heat[3]);
assert.ok(heat.every((v) => v >= 0 && v <= 1));
assert.deepStrictEqual(heatmap({ actions: [] }, 8), new Array(8).fill(0));
assert.ok(/^hsl\(\d+,\d+%,\d+%\)$/.test(heatColor(0.5)));
assert.notStrictEqual(heatColor(0), heatColor(1));

const cut = trimScript(vib, 500, 1500);
assert.strictEqual(duration(cut), 1000);
assert.strictEqual(cut.actions[0].at, 0);
assert.strictEqual(cut.actions[0].pos, 50);
assert.strictEqual(cut.actions[cut.actions.length - 1].pos, 50);
assert.ok(cut.actions.some((a) => a.at === 500 && a.pos === 100));
assert.throws(() => trimScript(vib, 500, 550));
assert.strictEqual(vib.actions.length, 3);            // the original is kept

const twice = loopScript(vib, 2);
assert.strictEqual(duration(twice), 4000);
assert.ok(twice.actions.some((a) => a.at === 3000 && a.pos === 100));
for (let i = 1; i < twice.actions.length; i++) assert.ok(twice.actions[i].at > twice.actions[i - 1].at);
assert.throws(() => loopScript({ actions: [] }, 2));

const b = { actions: [{ at: 0, pos: 40 }, { at: 500, pos: 40 }] };
const both = stitchScripts(vib, b, 250);
assert.strictEqual(duration(both), 2000 + 250 + 500);
assert.ok(both.actions.some((a) => a.at === 2250 && a.pos === 40));
// Two-track scripts keep both tracks through every tool.
const two = { actions: vib.actions, channels: { V1: { actions: [{ at: 0, pos: 10 }, { at: 2000, pos: 90 }] } } };
assert.strictEqual(trimScript(two, 0, 1000).channels.V1.actions.pop().pos, 50);
assert.strictEqual(duration({ actions: loopScript(two, 3).channels.V1.actions }), 6000);
assert.ok(stitchScripts(two, b).channels.V1.actions.length >= 4);
// A mood tag does not survive an edit: the result is a plain script.
assert.strictEqual('mood' in trimScript({ ...vib, mood: { x: 1 } }, 0, 1000), false);

// ---- audio feel
const rate = 48000, fft = 2048;
const frame = (bass, mid) => {
  const bins = new Uint8Array(fft / 2);
  const hz = rate / fft;
  for (let i = 1; i < bins.length; i++) { const f = i * hz; bins[i] = f < 200 ? bass : f < 4000 ? mid : 0; }
  return bins;
};
let feel = new AudioFeel(rate, fft);
let t = 0;
// Silence gives nothing.
for (let i = 0; i < 20; i++) { const r = feel.step(frame(0, 0), (t += 50)); assert.deepStrictEqual(r.levels, [0, 0]); assert.strictEqual(r.beat, false); }
// A kick every 500 ms over steady mids: beats are found, about two a second.
let peak = 0;
for (let i = 0; i < 200; i++) {
  const r = feel.step(frame(i % 10 === 0 ? 230 : 25, 90), (t += 50), 'beat', 0.5);
  peak = Math.max(peak, r.levels[0]);
  assert.ok(r.levels.every((v) => v >= 0 && v <= 100));
}
assert.ok(feel.beats >= 15 && feel.beats <= 22, `beats ${feel.beats}`);
assert.ok(peak >= 80, `peak ${peak}`);
// Volume and bass modes follow the sound without needing a beat.
feel = new AudioFeel(rate, fft);
let r;
for (let i = 0; i < 20; i++) r = feel.step(frame(200, 200), i * 50, 'volume', 0.5);
assert.ok(r.levels[0] > 60 && r.levels[1] > 60);
for (let i = 20; i < 60; i++) r = feel.step(frame(0, 0), i * 50, 'bass', 0.5);
assert.deepStrictEqual(r.levels, [0, 0]);

console.log('limits, script tools and audio feel passed');
