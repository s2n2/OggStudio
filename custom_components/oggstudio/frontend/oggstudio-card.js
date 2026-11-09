/* OggStudio card: record, import, save and replay patterns on Ogg devices.
 * Scripts are funscript JSON ({actions:[{at,pos}]}, pos 0-100 = intensity);
 * a second motor is stored as channels.V1. Share codes are "ogg1:" + base64
 * of gzip(JSON) ("ogg0:" + base64(JSON) where CompressionStream is missing).
 */
(() => {
  const TAG = 'oggstudio-card';
  if (customElements.get(TAG)) return;
  const VERSION = '0.10.0';
  const DEVICE_KEY = 'oggstudio_device';
  const SPEEDS = ['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x'];
  const SAMPLE_MS = 100;
  const LIVE_MS = 100;
  const VIDEO_TICK_MS = 100;
  const VIDEO_OFFSET_KEY = 'oggstudio_video_offset';
  const PARTS = ['record', 'stroke', 'take', 'library', 'video', 'import'];
  const NO_DEVICE = 'none';           // record without a device
  const TAKE_SRC = 'take';      // "Current take" in script lists (never a saved name)
  // One card class, several dashboard cards: each shows a subset of the parts.
  const VARIANTS = {
    'oggstudio-card': { name: 'OggStudio', sub: 'Record, import, replay and sync to video', parts: PARTS.filter((p) => p !== 'stroke'), size: 9,
      description: 'Everything in one card: record, library, video sync and import.' },
    'oggstudio-recorder-card': { name: 'OggStudio Recorder', sub: 'Draw a pattern with your finger and save it', parts: ['record', 'take'], size: 6,
      description: 'Big touch pads to record (or just play live), then save the take.' },
    'oggstudio-player-card': { name: 'OggStudio Player', sub: 'Play saved patterns and import scripts', parts: ['library', 'take', 'import'], size: 5,
      description: 'Pick a saved pattern and play it; paste or load funscripts and share codes.' },
    'oggstudio-video-card': { name: 'OggStudio Video', sub: 'Play a local video with its script, or record one', parts: ['video', 'take'], size: 7,
      description: 'Sync a video on this device with a script, and record a funscript for it.' },
    'oggstudio-stroke-card': { name: 'OggStudio Stroke', sub: 'Record stroke scripts (for a Handy) between two limits', parts: ['stroke', 'take'], size: 8,
      description: 'Stroke recorder: set an upper and lower limit, hold a speed to stroke between them, record a stroke funscript.' },
  };
  // Pointer capture can fail (a pointer already gone); never let it stop a press.
  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (_) { /* no capture */ } };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const b64 = (buf) => {
    const bytes = new Uint8Array(buf); let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

  async function encodeCode(script) {
    const json = JSON.stringify(script);
    if (window.CompressionStream) {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
      return 'ogg1:' + b64(await new Response(stream).arrayBuffer());
    }
    return 'ogg0:' + b64(new TextEncoder().encode(json));
  }

  async function decodeText(text) {
    const value = text.trim();
    if (value.startsWith('ogg1:')) {
      if (!window.DecompressionStream) throw new Error('This browser cannot read compressed codes');
      const stream = new Blob([unb64(value.slice(5))]).stream().pipeThrough(new DecompressionStream('gzip'));
      return JSON.parse(await new Response(stream).text());
    }
    if (value.startsWith('ogg0:')) return JSON.parse(new TextDecoder().decode(unb64(value.slice(5))));
    return JSON.parse(value);
  }

  // Run modes: how a stroke script (pos = position) becomes vibration
  // intensity at playback. Stroke scripts are stored as they are; the same
  // maths runs in Home Assistant (convert.py) for saved scripts.
  const RUN_MODES = {
    speed: 'Speed: faster strokes vibrate harder',
    position: 'Position: higher = stronger (vibration scripts)',
    upper: 'Position above 50%: 50% and below = off, 75% = half power',
    combo: 'Speed + position combined',
    down: 'Speed, downstrokes only',
    up: 'Speed, upstrokes only',
  };
  const RUN_MODE_DEFAULT = 'speed';
  const runModeOptions = () => Object.entries(RUN_MODES).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  const isStroke = (script) => Boolean(script && script.metadata && script.metadata.type === 'stroke');
  // File names: the funscript convention for a vibration track is "name.vib.funscript"
  // (stroke: plain "name.funscript"), so the type survives outside OggStudio.
  const VIB_FILE = /\.vib\.(funscript|json)$/i;
  const fileKind = (name, kind) => (kind === 'auto' && VIB_FILE.test(name || '') ? 'vibration' : kind);
  const fileTitle = (name) => String(name || '').replace(/(\.vib)?\.(funscript|json)$/i, '');

  // Speed of a move as intensity: a full 0-100 stroke in a quarter second
  // (400 %/s) = 100%.
  const speedIntensity = (dpos, dtMs) => (dtMs > 0 ? Math.min(100, Math.abs(dpos) / dtMs * 250) : 0);

  // Intensity for one move of a stroke script. Combined: speed sets the
  // strength and position fills up to 35% of what is left above it, so fast
  // strokes still reach 100%, slow deep strokes and holds high up still
  // register, and nothing jumps when a stroke turns round.
  function moveIntensity(mode, from, to, dtMs) {
    const s = speedIntensity(to - from, dtMs);
    if (mode === 'down') return to < from ? s : 0;
    if (mode === 'up') return to > from ? s : 0;
    if (mode === 'combo') return s + (100 - s) * 0.35 * ((from + to) / 2) / 100;
    return s;
  }

  // Position above 50% as power: 50 and below = 0, then 0-100 over the top half.
  const upperHalf = (pos) => Math.max(0, Math.round((pos - 50) * 2));

  const cleanActions = (actions) => (Array.isArray(actions) ? actions : [])
    .filter((x) => x && Number.isFinite(x.at) && Number.isFinite(x.pos))
    .map((x) => ({ at: Math.max(0, Math.round(x.at)), pos: Math.round(Math.min(100, Math.max(0, x.pos))) }))
    .sort((x, y) => x.at - y.at);

  // Stroke actions -> vibration intensity. Each move holds its intensity
  // for the whole move (a step, not a ramp), ending at 0.
  function toIntensity(actions, mode) {
    const a = cleanActions(actions);
    if (mode === 'upper') return a.map((x) => ({ at: x.at, pos: upperHalf(x.pos) }));
    if (!RUN_MODES[mode] || mode === 'position' || a.length < 2) return a;
    const out = [];
    const push = (at, pos) => {
      const last = out[out.length - 1];
      if (last && last.at >= at) last.pos = pos; else out.push({ at, pos });
    };
    for (let i = 1; i < a.length; i++) {
      const v = Math.round(moveIntensity(mode, a[i - 1].pos, a[i].pos, a[i].at - a[i - 1].at));
      push(a[i - 1].at, v);
      if (a[i].at - a[i - 1].at > 1) push(a[i].at - 1, v);
    }
    push(a[a.length - 1].at, 0);
    return out;
  }

  // A script ready for a vibration device: stroke scripts converted with
  // the run mode, vibration scripts unchanged.
  function runScript(script, mode) {
    if (!isStroke(script)) return script;
    const out = { ...script, actions: toIntensity(script.actions, mode), metadata: { ...script.metadata, type: 'vibration' } };
    if (script.channels && script.channels.V1) out.channels = { V1: { actions: toIntensity(script.channels.V1.actions, mode) } };
    return out;
  }

  // Imported scripts. kind: 'stroke' (positions, converted at playback),
  // 'vibration' (pos = intensity) or 'auto' (what the script says it is,
  // else stroke: most funscripts are made for stroke devices).
  function normalise(input, kind, inverted) {
    const type = kind === 'auto' ? (input.metadata && input.metadata.type === 'vibration' ? 'vibration' : 'stroke') : kind;
    const flip = (acts) => (inverted ? acts.map((x) => ({ at: x.at, pos: 100 - x.pos })) : acts);
    const script = { version: '1.0', inverted: false, range: 100, actions: flip(cleanActions(input.actions)) };
    const v1 = input.channels && (input.channels.V1 || input.channels.v1);
    if (v1 && Array.isArray(v1.actions)) script.channels = { V1: { actions: flip(cleanActions(v1.actions)) } };
    if (!script.actions.length) throw new Error('The script has no actions');
    script.metadata = { creator: 'OggStudio', type, ...(input.metadata && input.metadata.title ? { title: String(input.metadata.title) } : {}) };
    return script;
  }

  // Live: intensity now from position and velocity (% per second).
  function liveIntensity(mode, pos, vel) {
    if (mode === 'position') return pos;
    if (mode === 'upper') return upperHalf(pos);
    return moveIntensity(mode, pos - vel / 10, pos, 100);   // the last 100 ms of movement
  }

  // Stroke recorder. Holding (or latching) a speed strokes between the lower
  // and upper limits at that device speed, whatever the range: a speed is a
  // % of top speed, and 100% = a full 0-100 stroke in a quarter second
  // (400 units/s, the same scale as the Speed run mode).
  const STROKE_TOP = 400;   // position units per second at 100%
  const STROKE_SPEEDS = [{ name: 'Slow', pct: 30 }, { name: 'Medium', pct: 55 }, { name: 'Fast', pct: 100 }];
  const STROKE_PCT_MIN = 5;   // the Handy's slowest smooth speed is about 8% (32 mm/s)
  const okPct = (v) => Number.isInteger(v) && v >= STROKE_PCT_MIN && v <= 100;
  const STROKE_SPEED_KEY = 'oggstudio_stroke_speeds';
  const strokeVel = (pct) => pct / 100 * STROKE_TOP / 1000;               // units per ms
  const STROKE_MODE_KEY = 'oggstudio_stroke_mode';
  const STROKE_LIMIT_KEY = 'oggstudio_stroke_limits';

  // Move for dtMs at vel (units per ms). Returns the new position and
  // direction, and each turn (a limit reached) with how far through dtMs it
  // happened. Outside the range it heads into it at the same speed.
  function strokeStep(pos, dir, lower, upper, vel, dtMs) {
    const span = upper - lower;
    if (span < 1) return { pos, dir, turns: [] };
    if (pos < lower) dir = 1; else if (pos > upper) dir = -1;
    const total = vel * Math.min(dtMs, 100);
    let left = total;
    const turns = [];
    for (let guard = 0; guard < 64 && left > 1e-9; guard++) {
      const target = dir > 0 ? upper : lower;
      const dist = (target - pos) * dir;
      if (left < dist) { pos += left * dir; left = 0; break; }
      pos = target; left -= dist; dir = -dir;
      turns.push({ pos: target, frac: (total - left) / total });
    }
    return { pos, dir, turns };
  }

  // Set limit: the new limit pairs with the one set before it (since the
  // last reset): above it = the upper limit, below = the lower. The first
  // one after a reset replaces whichever end is nearer.
  function strokeSetLimit(lim, pos) {
    const p = Math.round(Math.min(100, Math.max(0, pos)));
    const keep = lim.last ? lim[lim.last] : (Math.abs(p - lim.lower) <= Math.abs(p - lim.upper) ? lim.upper : lim.lower);
    if (Math.abs(p - keep) < 2) return null;   // both limits in one place: no range
    return p > keep ? { lower: keep, upper: p, last: 'upper' } : { lower: p, upper: keep, last: 'lower' };
  }
  const STROKE_LIMITS_RESET = { lower: 0, upper: 100, last: null };

  // Outputs: up to two devices (or motors) follow a recorder live. A target
  // is "deviceId|motor": motor 0 or 1, b = both motors, l = linear (stroker).
  // "none" = record only, "off" = no second output.
  const OUT_KEY = 'oggstudio_outputs';
  const FOLLOW_STROKER = 'stroker';
  const parseTarget = (t) => { const m = /^(.+)\|([01bl])$/.exec(t || ''); return m ? { id: m[1], motor: m[2] } : null; };

  // Per-device levels from output values: two outputs on one device become
  // one command (motor 1 and motor 2), "both" drives every motor.
  function outLevels(targets, values, devices) {
    const out = new Map();
    targets.forEach((t, i) => {
      const p = parseTarget(t);
      const dev = p && devices.find((d) => d.id === p.id);
      const v = values[i];
      if (!dev || v === null || v === undefined) return;
      const e = out.get(dev.id) || { dev, levels: dev.dual ? [0, 0] : [0], vibe: false, linear: null };
      if (p.motor === 'l') e.linear = v;
      else {
        e.vibe = true;
        if (p.motor === 'b') e.levels = e.levels.map((x) => Math.max(x, v));
        else { const m = Math.min(Number(p.motor), e.levels.length - 1); e.levels[m] = Math.max(e.levels[m], v); }
      }
      out.set(dev.id, e);
    });
    return [...out.values()];
  }
  const STROKE_MIN_SPAN = 2;

  // Range rail: what a touch at v grabs. Near a limit = that limit, inside
  // the band = the whole range, outside = the nearer limit (which jumps there).
  function railGrab(lim, v, tol) {
    const du = Math.abs(v - lim.upper), dl = Math.abs(v - lim.lower);
    if (Math.min(du, dl) <= tol) return du <= dl ? { mode: 'upper' } : { mode: 'lower' };
    if (v > lim.lower && v < lim.upper) return { mode: 'move', off: v - lim.lower };
    return { mode: v > lim.upper ? 'upper' : 'lower' };
  }

  // New limits while dragging on the rail.
  function railDrag(lim, grab, v) {
    const r = (x) => Math.round(Math.min(100, Math.max(0, x)));
    if (grab.mode === 'upper') return { lower: lim.lower, upper: Math.max(lim.lower + STROKE_MIN_SPAN, r(v)) };
    if (grab.mode === 'lower') return { lower: Math.min(lim.upper - STROKE_MIN_SPAN, r(v)), upper: lim.upper };
    const span = lim.upper - lim.lower;
    const lower = Math.min(100 - span, r(v - grab.off));
    return { lower, upper: lower + span };
  }

  // Touching the position lane: until the stroker reaches the finger it moves
  // no faster than the last speed used (Slow if none), so a touch far from
  // where it is never makes it jump. After that it follows the finger.
  function approachStep(pos, target, vel, dtMs) {
    const step = vel * Math.min(dtMs, 100);
    const d = target - pos;
    if (Math.abs(d) <= step) return { pos: target, caught: true };
    return { pos: pos + Math.sign(d) * step, caught: false };
  }

  // Level (0-100) of a script track at time ms: linear between actions,
  // 0 before the first action, holds the last value after the end.
  function sampleAt(actions, ms) {
    if (!actions || !actions.length || ms < actions[0].at) return 0;
    let lo = 0, hi = actions.length - 1;
    if (ms >= actions[hi].at) return actions[hi].pos;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (actions[mid].at <= ms) lo = mid; else hi = mid; }
    const a = actions[lo], b = actions[hi];
    return b.at === a.at ? b.pos : a.pos + (b.pos - a.pos) * (ms - a.at) / (b.at - a.at);
  }

  // The next action after ms (a stroker heads for it), or null at the end.
  function nextAction(actions, ms) {
    if (!actions || !actions.length || ms >= actions[actions.length - 1].at) return null;
    let lo = 0, hi = actions.length - 1;
    if (ms < actions[0].at) return actions[0];
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (actions[mid].at <= ms) lo = mid; else hi = mid; }
    return actions[hi];
  }

  // Merge recording passes made against a video. A later pass replaces
  // whatever earlier passes recorded inside its time span (punch-in).
  function mergePasses(passes) {
    let out = [];
    for (const pass of passes) {
      if (!pass.length) continue;
      const from = pass[0].at, to = pass[pass.length - 1].at;
      out = out.filter((a) => a.at < from || a.at > to).concat(pass);
    }
    out.sort((a, b) => a.at - b.at);
    return out.filter((a, i) => i === 0 || a.at !== out[i - 1].at || (out[i - 1] = a, false));
  }

  // Game controller. Up/down move the level at the chosen speed while held,
  // left/right step that speed, buttons start/stop recording, zero the level
  // and (two motors) pick which motor the controller drives. A binding is a
  // button {b}, an axis direction {a, d} (analog sticks are proportional) or
  // a key {k} for controllers in keyboard mode.
  const GP_SPEEDS = [15, 30, 60, 100, 180, 300];   // % per second while held
  const GP_SPEED_DEFAULT = 3;
  const GP_ACTIONS = ['up', 'down', 'left', 'right', 'rec', 'zero', 'motor'];
  const GP_LABELS = { up: 'Up (level up)', down: 'Down (level down)', left: 'Left (slower)', right: 'Right (faster)', rec: 'Record start/stop', zero: 'Level to 0', motor: 'Switch motor' };
  const GP_DEFAULT_MAP = {
    up: [{ b: 12 }, { a: 1, d: -1 }, { k: 'ArrowUp' }],
    down: [{ b: 13 }, { a: 1, d: 1 }, { k: 'ArrowDown' }],
    left: [{ b: 14 }, { a: 0, d: -1 }, { k: 'ArrowLeft' }],
    right: [{ b: 15 }, { a: 0, d: 1 }, { k: 'ArrowRight' }],
    rec: [{ b: 0 }, { k: 'Enter' }, { k: 'MediaPlayPause' }],
    zero: [{ b: 1 }, { k: 'Escape' }, { k: 'Backspace' }],
    motor: [{ b: 3 }],
  };
  const GP_MAP_KEY = 'oggstudio_pad_map';
  const GP_SPEED_KEY = 'oggstudio_pad_speed';
  const GP_ON_KEY = 'oggstudio_pad_on';
  const GP_DEAD = 0.25;
  const GP_POLL_MS = 20;
  const GP_HAT_TOL = 0.12;        // hat switch: one axis, one value per direction
  const GP_REST_SAMPLES = 40;     // ~0.8 s of hands-off readings when learning
  const GP_HOLD_ACTIONS = ['up', 'down', 'left', 'right', 'zero', 'motor'];

  // How hard one action is pressed, 0..1.
  function gpStrength(binds, pad, keys) {
    let best = 0;
    for (const bind of binds || []) {
      let v = 0;
      if (bind.k !== undefined) v = keys && keys.has(bind.k) ? 1 : 0;
      else if (!pad) continue;
      else if (bind.b !== undefined) { const btn = pad.buttons && pad.buttons[bind.b]; v = btn && btn.pressed ? 1 : 0; }
      else if (bind.a !== undefined && bind.v !== undefined) v = Math.abs(((pad.axes && pad.axes[bind.a]) ?? 99) - bind.v) < GP_HAT_TOL ? 1 : 0;
      else if (bind.a !== undefined) {
        const dead = bind.z || GP_DEAD;
        const raw = (((pad.axes && pad.axes[bind.a]) || 0) - (bind.r || 0)) * bind.d;
        v = raw > dead ? (raw - dead) / (1 - dead) : 0;
      }
      best = Math.max(best, Math.min(1, v));
    }
    return best;
  }

  function gpRead(map, pad, keys) {
    const out = {};
    for (const action of Object.keys(map)) out[action] = gpStrength(map[action], pad, keys);
    return out;
  }

  // New level after dtMs with up/down held (strengths 0..1).
  function gpStep(level, up, down, speed, dtMs) {
    return Math.min(100, Math.max(0, level + (up - down) * speed * Math.min(dtMs, 100) / 1000));
  }

  // Learning, step 1: hands off. Each axis's resting value and how much it
  // jitters, from a run of axis readings.
  function gpCalibrate(samples) {
    const len = Math.max(0, ...samples.map((x) => x.length));
    const rest = [], noise = [];
    for (let i = 0; i < len; i++) {
      const vals = samples.map((x) => x[i] || 0);
      const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
      rest.push(mean);
      noise.push(Math.max(0, ...vals.map((v) => Math.abs(v - mean))));
    }
    return { rest, noise };
  }

  // How far an axis must move from rest to count: well clear of its jitter.
  const gpThreshold = (cal, i) => Math.max(0.35, 2 * ((cal && cal.noise[i]) || 0) + 0.2);
  const round2 = (v) => Math.round(v * 100) / 100;

  // Learning, later steps: what is being held right now? A pressed button
  // (other than the Record button used to confirm), else the axis furthest
  // beyond its own jitter. Hat switches (one axis resting outside -1..1,
  // a value per direction) bind to that value; other axes to a direction,
  // measured from their resting point.
  function gpPickInput(pad, cal, confirmButton) {
    if (!pad) return null;
    const b = gpFirstButton(pad, confirmButton, cal && cal.stuck);
    if (b >= 0) return { b };
    const axes = pad.axes || [];
    let best = -1, score = 1;
    for (let i = 0; i < axes.length; i++) {
      const s = Math.abs(axes[i] - ((cal && cal.rest[i]) || 0)) / gpThreshold(cal, i);
      if (s > score) { score = s; best = i; }
    }
    if (best < 0) return null;
    const v = axes[best], rest = (cal && cal.rest[best]) || 0;
    if (Math.abs(rest) > 1.05) return { a: best, v: round2(v) };
    const bind = { a: best, d: v > rest ? 1 : -1 };
    if (Math.abs(rest) > 0.05) bind.r = round2(rest);
    const dead = round2(Math.max(GP_DEAD, ((cal && cal.noise[best]) || 0) + 0.1));
    if (dead > GP_DEAD) bind.z = dead;
    return bind;
  }

  // First pressed button, skipping `except` and any button that reads as
  // pressed all the time (some pads report one permanently).
  function gpFirstButton(pad, except, stuck) {
    const buttons = (pad && pad.buttons) || [];
    for (let i = 0; i < buttons.length; i++) {
      if (i !== except && buttons[i] && buttons[i].pressed && !(stuck && stuck.includes(i))) return i;
    }
    return -1;
  }

  const gpPressed = (pad) => [...((pad && pad.buttons) || [])].map((b, i) => (b && b.pressed ? i : -1)).filter((i) => i >= 0);

  // Of several gamepads (Android often lists extra input devices), the one
  // the user last pressed a button on; before that, a standard-mapped one,
  // else the one with the most buttons.
  function gpChoosePad(pads, lastActive) {
    const live = pads.filter((p) => p && p.connected);
    return live.find((p) => p.index === lastActive)
      || live.find((p) => p.mapping === 'standard')
      || live.sort((a, b) => (b.buttons || []).length - (a.buttons || []).length)[0] || null;
  }

  // One line of what a pad reads now, for the raw readout and the log.
  const gpRaw = (pad) => (!pad ? 'no gamepad' : `#${pad.index} "${String(pad.id).slice(0, 40)}" ${pad.mapping || 'no-mapping'} · pressed [${gpPressed(pad).join(',')}] · axes ${[...pad.axes].map((v, i) => `${i}:${v.toFixed(2)}`).join(' ')}`);

  const gpDescribe = (b) => (!b ? 'default' : b.k !== undefined ? `key ${b.k}` : b.b !== undefined ? `button ${b.b}`
    : b.v !== undefined ? `hat axis ${b.a} at ${b.v}` : `axis ${b.a} ${b.d > 0 ? '+' : '-'}`);

  // Turn learned bindings into a full map: a learned action uses what was
  // learned plus its default keyboard keys, the rest keep their defaults;
  // anything learned for one action is dropped from the others.
  function gpBuildMap(learned, defaultMap = GP_DEFAULT_MAP) {
    const key = (b) => JSON.stringify(b);
    const taken = new Set(Object.values(learned).flat().map(key));
    const map = {};
    for (const action of Object.keys(defaultMap)) {
      const own = learned[action] && learned[action].length ? learned[action] : [];
      // Once anything is learned, default stick axes go: on a pad whose axes
      // rest off-centre or jitter they would fire on their own.
      const defaults = defaultMap[action].filter((b) => !taken.has(key(b))
        && (own.length ? b.k !== undefined : !(taken.size && b.a !== undefined)));
      map[action] = [...own, ...defaults];
    }
    return map;
  }

  // Which card section the controller drives: video recording when a video
  // is loaded in this card, otherwise the Record pads.
  function gpTargetFor(parts, hasVideo) {
    if (parts.includes('video') && hasVideo) return 'video';
    if (parts.includes('stroke')) return 'stroke';
    if (parts.includes('record')) return 'record';
    return null;
  }

  // Stroke recorder controls: hold a speed to stroke, set or reset limits.
  const ST_ACTIONS = ['rec', 'slow', 'med', 'fast', 'limit', 'reset'];
  const ST_LABELS = { rec: 'Record start/stop', slow: 'Slow stroke (hold)', med: 'Medium stroke (hold)', fast: 'Fast stroke (hold)', limit: 'Set range limit', reset: 'Reset range limits' };
  const ST_DEFAULT_MAP = {
    rec: [{ b: 0 }, { k: 'Enter' }, { k: 'MediaPlayPause' }],
    slow: [{ b: 14 }, { k: 'ArrowLeft' }],
    med: [{ b: 13 }, { k: 'ArrowDown' }],
    fast: [{ b: 15 }, { k: 'ArrowRight' }],
    limit: [{ b: 12 }, { b: 2 }, { k: 'ArrowUp' }, { k: 'Space' }],
    reset: [{ b: 1 }, { k: 'Escape' }, { k: 'Backspace' }],
  };
  // Which actions a controller profile has, and where its learned map lives.
  const GP_PROFILES = {
    level: { actions: GP_ACTIONS, labels: GP_LABELS, defaults: GP_DEFAULT_MAP, hold: GP_HOLD_ACTIONS, mapKey: GP_MAP_KEY },
    stroke: { actions: ST_ACTIONS, labels: ST_LABELS, defaults: ST_DEFAULT_MAP, hold: ['slow', 'med', 'fast', 'limit', 'reset'], mapKey: 'oggstudio_pad_map_stroke' },
  };
  let gpOwner = null;   // with several OggStudio cards on screen, only one listens

  const duration = (s) => Math.max(
    s.actions.length ? s.actions[s.actions.length - 1].at : 0,
    s.channels && s.channels.V1.actions.length ? s.channels.V1.actions[s.channels.V1.actions.length - 1].at : 0);
  const fmt = (ms) => `${(ms / 1000).toFixed(1)} s`;

  class OggStudioCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._devices = [];
      this._remembered = null;
      this._rememberedLoaded = false;
      this._take = null;
      this._recording = false;
      this._live = false;
      this._samples = null;
      this._vscript = null;
      this._vurl = null;
      this._gpKeys = new Set();
      this._gpPrev = {};
      this._gpFloat = [null, null];
      this._gpMotor = 0;
      // Who this card is, for control claims (one controller per device).
      this._owner = (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
      this._claimed = new Map();     // stop entity -> device, while this card drives it
      this._claimAt = {};
      this._outLast = {};
      this._linLast = {};
      this.shadowRoot.addEventListener('pointerdown', () => { gpOwner = this; }, true);
    }

    static get variant() { return VARIANTS[TAG]; }
    get _variant() { return this.constructor.variant; }
    get _baseParts() {
      const wanted = this._config && Array.isArray(this._config.sections) ? this._config.sections.filter((p) => PARTS.includes(p)) : [];
      return wanted.length ? wanted : this._variant.parts;
    }

    // A card with one recorder (pads or stroke) can switch between the two
    // with the Vibrate / Stroke toggle; the choice is kept per card type.
    get _canToggleKind() { const b = this._baseParts; return b.includes('record') !== b.includes('stroke'); }
    get _kindKey() { return `oggstudio_rec_kind:${this.localName}`; }
    get _recKind() {
      if (this._kind) return this._kind;
      let saved = null;
      try { saved = localStorage.getItem(this._kindKey); } catch (_) { /* private mode */ }
      this._kind = saved === 'stroke' || saved === 'vibrate' ? saved : (this._baseParts.includes('stroke') ? 'stroke' : 'vibrate');
      return this._kind;
    }

    get _parts() {
      const base = this._baseParts;
      if (!this._canToggleKind) return base;
      const [from, to] = this._recKind === 'stroke' ? ['record', 'stroke'] : ['stroke', 'record'];
      return base.map((x) => (x === from ? to : x));
    }

    _setRecKind(kind) {
      if (kind === this._recKind) return;
      // Finish whatever the other recorder was doing.
      if (this._recording) this._stopRecording();
      if (this._live) { this._el('live').checked = false; this._setLive(false); }
      if (this._stRecording) this._stStop();
      if (this._st) { this._st.touch = null; this._st.pad = null; this._st.drag = null; this._st.latch = null; }
      this._el('stlive').checked = false;
      this._stHalt();
      this._kind = kind;
      try { localStorage.setItem(this._kindKey, kind); } catch (_) { /* private mode */ }
      this._applyParts();
      if (this._rp && this._rp.playing) this._rpTick();
      this._gpStatus();
    }

    _applyParts() {
      const parts = this._parts;
      for (const sec of this.shadowRoot.querySelectorAll('[data-part]')) {
        sec.classList.toggle('off', !parts.includes(sec.dataset.part));
        sec.style.order = String(parts.indexOf(sec.dataset.part) + 1);   // sections follow the card's own order
      }
      for (const tog of this.shadowRoot.querySelectorAll('.kind')) {
        tog.hidden = !this._canToggleKind;
        for (const b of tog.querySelectorAll('button')) b.classList.toggle('on', b.dataset.kind === this._recKind);
      }
      const rec = parts.includes('stroke') ? 'stroke' : parts.includes('record') ? 'record' : null;
      const slot = rec && this.shadowRoot.querySelector(`[data-part="${rec}"] .outslot`);
      const box = this._el('outbox');
      this._el('outhome').appendChild(box);      // the devices box always sits at the top
      const cslot = rec && this.shadowRoot.querySelector(`[data-part="${rec}"] .ctlslot`);
      (cslot || this._el('outhome')).insertBefore(this._el('ctlbox'), cslot ? null : box);
      // The controller tick box sits with the recorder's live toggles (or under the video's Rec).
      const gslot = this.shadowRoot.querySelector(`[data-part="${rec || 'video'}"]:not(.off) .gpslot`);
      if (gslot) gslot.appendChild(this._el('gp'));
      this._el('outhome').classList.remove('off');
      this._el('outhome').style.order = '0';
      this._el('ctlbox').hidden = !rec;
      if (this._rp) this._ctlShow();
      this._el('devbox').hidden = true;      // one device choice for everything: the devices box
      if (this._outs) this._outRender();
    }

    get _strokeKind() { return this._parts.includes('stroke'); }

    setConfig(config) { this._config = config || {}; this._render(); }
    getCardSize() { return this._variant.size; }
    static getStubConfig() { return {}; }

    set hass(hass) {
      this._hass = hass;
      if (!this._registryLoaded) { this._registryLoaded = true; this._loadRegistry(); }
      this._update();
    }

    async _loadRegistry() {
      if (!this._rememberedLoaded && !this._loadingRemembered) {
        this._loadingRemembered = true;
        this._loadRemembered();
      }
      try {
        const [entities, devices] = await Promise.all([
          this._hass.callWS({ type: 'config/entity_registry/list' }),
          this._hass.callWS({ type: 'config/device_registry/list' }),
        ]);
        const names = new Map(devices.map((d) => [d.id, d.name_by_user || d.name || 'Device']));
        const byDevice = new Map();
        this._studio = {};
        for (const e of entities) {
          if (e.disabled_by) continue;
          const uid = String(e.unique_id || '');
          if (e.platform === 'oggstudio') {
            if (uid.endsWith(':saved_script')) this._studio.saved = e.entity_id;
            if (uid.endsWith(':speed')) this._studio.speed = e.entity_id;
            continue;
          }
          if (e.platform !== 'ogg' || !e.device_id || uid.split(':').length < 3) continue;
          const d = byDevice.get(e.device_id) || { id: e.device_id, name: names.get(e.device_id) };
          if (uid.endsWith(':stop')) d.stop = e.entity_id;
          if (uid.endsWith(':connected')) d.connected = e.entity_id;
          if (uid.endsWith(':motor_level_1')) d.dual = true;
          if (uid.endsWith(':linear_0')) d.linear = e.entity_id;
          if (uid.endsWith(':intensity') || uid.endsWith(':motor_level_0')) d.vibe = true;
          byDevice.set(e.device_id, d);
        }
        this._devices = [...byDevice.values()].filter((d) => d.stop).sort((a, b) => a.name.localeCompare(b.name));
        this._registryDone = true;
      } catch (err) {
        this._toast('Could not read the device list: ' + (err.message || err));
      }
      this._update();
    }

    _render() {
      this.shadowRoot.innerHTML = `
        <style>
          :host{--ink:#e8edff;--muted:#8f9ab8;--line:rgba(174,194,246,.16)}
          ha-card{background:#0a1122;color:var(--ink);border-radius:22px;border:1px solid #293552;padding:16px;font-family:inherit;display:flex;flex-direction:column}
          .toast{order:99}
          h2{margin:0 0 2px;font-size:20px;letter-spacing:-.02em} .sub{color:var(--muted);font-size:12px;margin-bottom:12px}
          section{border:1px solid var(--line);border-radius:16px;padding:12px;margin-top:10px;background:rgba(255,255,255,.035)}
          h3{margin:0 0 8px;font-size:13px;color:#cdd6f6;letter-spacing:.01em}
          label{display:block;font-size:11px;color:var(--muted);margin:6px 0 3px}
          select,input[type=text],textarea{width:100%;box-sizing:border-box;background:#18233d;color:var(--ink);border:1px solid #33415f;border-radius:10px;padding:8px;font:inherit;font-size:13px}
          textarea{min-height:60px;resize:vertical;font-family:monospace;font-size:11px}
          .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap} .row > *{flex:1}
          button{border:1px solid rgba(118,200,239,.35);background:#24395a;color:#bef2ff;border-radius:12px;min-height:44px;padding:0 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
          button:disabled{opacity:.4;cursor:default}
          button.rec{width:100%;min-height:56px;font-size:16px;background:#5a2433;border-color:rgba(255,110,130,.5);color:#ffd2da}
          button.rec.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710}
          button.stop{background:rgba(246,104,121,.08);border-color:rgba(246,104,121,.3);color:#e9adb7}
          .pads{display:grid;grid-template-columns:1fr;gap:10px;margin:4px 0 10px}
          .pads.dual{grid-template-columns:1fr 1fr}
          .pad{position:relative;height:240px;border-radius:18px;border:1px solid #33415f;background:#141d33;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:ns-resize;outline:none}
          .pad:focus-visible{box-shadow:0 0 0 3px rgba(103,224,200,.45)}
          .pad .fill{position:absolute;left:0;right:0;bottom:0;height:0;background:linear-gradient(0deg,#2fbfa9,#67e0c8);transition:height .05s linear}
          .pad.active{border-color:#67e0c8}
          .pad .lab{position:absolute;top:10px;left:12px;font-size:12px;font-weight:700;color:#cdd6f6;mix-blend-mode:difference}
          .pad .pct{position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.55)}
          .pad .ticks{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 calc(25% - 1px),rgba(255,255,255,.07) calc(25% - 1px) 25%);pointer-events:none}
          input[type=range]{width:100%;accent-color:#67e0c8;height:28px}
          .val{font-variant-numeric:tabular-nums;text-align:right;color:#cdd6f6;font-size:12px}
          .take{font-size:12px;color:#cdd6f6;margin-bottom:6px}
          .hint{font-size:11px;color:var(--muted);margin-top:6px}
          .toast{min-height:16px;font-size:12px;color:#ffcf8a;margin-top:8px}
          .check{display:flex;gap:8px;align-items:center;font-size:13px;color:#cdd6f6;flex:0 0 auto;min-height:36px}
          .check input{width:20px;height:20px;accent-color:#67e0c8}
          video{width:100%;max-height:60vh;border-radius:12px;background:#000;margin-top:8px;display:block}
          input[type=file]{width:100%;font-size:12px;color:var(--muted)}
          button.go{width:100%;min-height:52px;font-size:16px;background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24;border-color:transparent}
          .vrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center}
          .vstat{font-size:12px;color:#cdd6f6;font-variant-numeric:tabular-nums;margin-top:6px;min-height:16px}
          .meter{height:6px;border-radius:3px;background:#18233d;overflow:hidden;margin-top:4px}
          .meter i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2fbfa9,#67e0c8);transition:width .1s linear}
          .meter.m2 i{background:linear-gradient(90deg,#8f7dff,#b49cff)}
          .hbar{position:relative;height:48px;margin-top:8px;border-radius:12px;border:1px solid #33415f;background:#141d33;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:ew-resize;outline:none}
          .hbar .fill{position:absolute;top:0;bottom:0;left:0;width:0;background:linear-gradient(90deg,rgba(47,191,169,.55),rgba(103,224,200,.85))}
          .hbar.m2 .fill{background:linear-gradient(90deg,rgba(143,125,255,.55),rgba(180,156,255,.85))}
          .hbar.active{border-color:#67e0c8}
          .hbar.rec{border-color:rgba(255,110,130,.55)}
          .hbar .lab{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:11px;font-weight:700;color:#e8edff;text-shadow:0 1px 3px rgba(0,0,0,.6)}
          .hbar .pct{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6)}
          .vrecrow{display:flex;gap:8px;align-items:center;margin-top:8px}
          .vrecrow .check{min-height:40px;font-size:12px}
          button.vrec{flex:0 0 auto;min-height:40px;padding:0 14px;background:#5a2433;border-color:rgba(255,110,130,.5);color:#ffd2da}
          button.vrec.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710}
          .vrecinfo{flex:1;text-align:right;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
          .gp{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:0 1 auto}
          .gp.on{flex:1 1 100%;margin-top:4px;padding:4px 10px 8px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.025)}
          .gp .check{min-height:36px;font-size:13px}
          .gpmore{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1 1 100%}
          .gpslot{display:contents}
          .stlive{display:flex;gap:8px 16px;align-items:center;flex-wrap:wrap;margin-top:6px}
          .gp .gpstat{flex:1;min-width:140px;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
          .gp .gpstat b{color:#bef2ff}
          .gp button{min-height:36px;flex:0 0 auto}
          .gplearn{flex-basis:100%;font-size:13px;color:#ffcf8a;font-weight:700}
          .gpraw{flex-basis:100%;font-size:10.5px;color:var(--muted);font-family:monospace;word-break:break-all}
          .st{display:grid;grid-template-columns:minmax(150px,52%) 1fr;gap:10px;margin:4px 0 10px}
          .sttrack{display:grid;grid-template-columns:44% 1fr;gap:6px;height:256px}
          .strail,.stlane{position:relative;border-radius:16px;border:1px solid #33415f;background:#141d33;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;cursor:ns-resize;outline:none}
          .strail.active,.stlane.active{border-color:#67e0c8}
          .strail:focus-visible,.stlane:focus-visible{box-shadow:0 0 0 3px rgba(103,224,200,.45)}
          .sttrack .ticks{position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent 0 calc(25% - 1px),rgba(255,255,255,.07) calc(25% - 1px) 25%);pointer-events:none}
          .stband{position:absolute;left:6px;right:6px;border-radius:10px;background:rgba(103,224,200,.22);box-sizing:border-box;pointer-events:none}
          .stband::before,.stband::after{content:'';position:absolute;left:18%;right:18%;height:6px;border-radius:3px;background:#67e0c8}
          .stband::before{top:-3px} .stband::after{bottom:-3px}
          .stband .grip{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:14px;color:rgba(103,224,200,.85)}
          .stshade{position:absolute;left:0;right:0;background:rgba(103,224,200,.08);border-top:1px dashed rgba(103,224,200,.45);border-bottom:1px dashed rgba(103,224,200,.45);box-sizing:border-box;pointer-events:none}
          .sttags{display:grid;grid-template-columns:44% 1fr;gap:6px;margin-bottom:4px;font-size:10px;font-weight:700;color:var(--muted);letter-spacing:.05em;text-align:center}
          .stpos{position:absolute;left:8%;right:8%;height:14px;margin-bottom:-7px;border-radius:7px;background:linear-gradient(90deg,#ff8aa0,#ffcf8a);box-shadow:0 0 12px rgba(255,138,160,.6)}
          .stlim{position:absolute;left:0;right:0;text-align:center;font-size:11px;font-weight:800;color:#bff5ea;font-variant-numeric:tabular-nums;pointer-events:none}
          .stlane .pct{position:absolute;top:8px;left:0;right:0;text-align:center;font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 1px 6px rgba(0,0,0,.55);pointer-events:none}
          .stside{display:flex;flex-direction:column;gap:8px}
          .stspd{flex:1;display:flex;flex-direction:column;justify-content:center;gap:4px;padding:4px 6px;border:1px solid var(--line);border-radius:14px;background:rgba(255,255,255,.025)}
          .stside button.sthold{min-height:40px;font-size:14px;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
          .stside button.sthold.on{background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24;border-color:transparent}
          .stctl{display:grid;grid-template-columns:1fr 1fr;gap:4px}
          .stsl{display:flex;align-items:center;gap:6px}
          .stsl input{flex:1;min-width:0;height:24px;margin:0}
          .stsl b{flex:0 0 42px;text-align:right;font-size:12.5px;color:#bef2ff;font-variant-numeric:tabular-nums}
          .st{position:relative}
          .ctltabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
          .ctltabs button{min-height:44px;font-size:14.5px;background:#24395a;color:#bef2ff}
          .ctltabs button.on{background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24;border-color:transparent}
          .rpbox{position:relative}
          button.rppick{width:100%;text-align:left;background:#18233d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
          .rppop{position:absolute;z-index:6;left:0;right:0;top:48px;max-height:300px;overflow:auto;padding:6px;border-radius:14px;border:1px solid #67e0c8;background:#101a30;box-shadow:0 10px 30px rgba(0,0,0,.6)}
          .rppop button{display:flex;justify-content:space-between;width:100%;min-height:40px;margin:2px 0;background:#18233d;text-align:left}
          .rppop button small{color:var(--muted);font-weight:600}
          .rppop .rpfile{display:block;margin:6px 2px 2px;font-size:12px;color:#cdd6f6}
          .rpbar{position:relative;height:14px;margin-top:8px;border-radius:7px;background:#18233d;overflow:hidden;cursor:pointer;touch-action:none}
          .rpbar i{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#2fbfa9,#67e0c8)}
          .rpinfo{font-size:12px;color:#cdd6f6;font-variant-numeric:tabular-nums;margin-top:4px;text-align:center;min-height:16px}
          .rprow{display:grid;grid-template-columns:1fr 84px auto;gap:8px;align-items:center;margin-top:6px}
          .rprow select{min-height:44px}
          #outhome{padding:0;border:0;background:none}
          .outbox{margin-top:0;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.025)}
          .outbox > label{margin-top:0}
          .outrow{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;align-items:center}
          .outrow.solo{grid-template-columns:1fr}
          .outrow.solo.take{grid-template-columns:1fr auto}
          .outrow button.outtake{min-height:38px;background:rgba(255,207,138,.12);border-color:rgba(255,207,138,.45);color:#ffcf8a}
          .outnote{font-size:11px;color:var(--muted);margin-top:4px}
          .stside button.stlatch{min-height:40px;padding:0 6px;font-size:11.5px;border-radius:9px;background:#141d33;color:var(--muted)}
          .stside button.stlatch.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710;border-color:transparent}
          .stside .row button{min-height:46px}
          .stinfo{font-size:12px;color:#cdd6f6;font-variant-numeric:tabular-nums;margin-top:6px;text-align:center}
          .rechead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
          .rechead h3{margin:0}
          .kind{display:flex;border:1px solid #33415f;border-radius:12px;overflow:hidden;flex:0 0 auto}
          .kind button{border:0;border-radius:0;min-height:38px;padding:0 14px;background:#141d33;color:var(--muted)}
          .kind button.on{background:linear-gradient(110deg,#2fbfa9,#67e0c8);color:#062a24}
          [hidden],.off{display:none!important}
        </style>
        <ha-card>
          <h2>${esc(this._config.title || this._variant.name)}</h2><div class="sub">${esc(this._variant.sub)} · v${VERSION}</div>
          <div id="devbox"><label>Playback device</label><select id="device"></select></div>
          <div class="gp" id="gp">
            <label class="check"><input id="gpon" type="checkbox"> 🎮 Controller</label>
            <div class="gpmore" id="gpmore" hidden>
              <span class="gpstat" id="gpstat"></span>
              <button id="gplearnbtn" type="button">Learn controls</button>
              <div class="gplearn" id="gplearn" hidden></div>
              <div class="gpraw" id="gpraw" hidden></div>
              <div class="row" id="gplearnrow" style="flex-basis:100%" hidden><button id="gpskip" type="button">Skip</button><button id="gpreset" type="button">Use defaults</button><button id="gpcancel" type="button" class="stop">Cancel</button></div>
            </div>
          </div>
          <section data-part="stroke">
            <div class="rechead"><h3>Stroke recorder</h3><div class="kind" role="group" aria-label="Recording type"><button type="button" data-kind="vibrate">〰 Vibrate</button><button type="button" data-kind="stroke">↕ Stroke</button></div></div>
            <div class="st">
              <div><div class="sttags"><span>RANGE</span><span>POSITION</span></div><div class="sttrack">
                <div class="strail" id="strail" tabindex="0" aria-label="Stroke range: drag a limit, or the middle to move the whole range"><div class="ticks"></div><div class="stband" id="stband"><span class="grip">⇕</span></div><span class="stlim" id="stup"></span><span class="stlim" id="stlo"></span></div>
                <div class="stlane" id="stlane" role="slider" tabindex="0" aria-label="Stroke position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><div class="ticks"></div><div class="stshade" id="stshade"></div><div class="stpos" id="stpos"></div><span class="pct" id="stpct">50</span></div>
              </div></div>
              <div class="stside">
                <div class="stspd"><div class="stsl"><input class="stpctr" type="range" min="${STROKE_PCT_MIN}" max="100" step="1" data-speed="2" aria-label="Fast speed"><b class="stpv" data-speed="2"></b></div><div class="stctl"><button class="sthold" type="button" data-speed="2">Fast</button><button class="stlatch" type="button" data-speed="2" aria-pressed="false" title="Keep running at this speed">⟳ Latch</button></div></div>
                <div class="stspd"><div class="stsl"><input class="stpctr" type="range" min="${STROKE_PCT_MIN}" max="100" step="1" data-speed="1" aria-label="Medium speed"><b class="stpv" data-speed="1"></b></div><div class="stctl"><button class="sthold" type="button" data-speed="1">Medium</button><button class="stlatch" type="button" data-speed="1" aria-pressed="false" title="Keep running at this speed">⟳ Latch</button></div></div>
                <div class="stspd"><div class="stsl"><input class="stpctr" type="range" min="${STROKE_PCT_MIN}" max="100" step="1" data-speed="0" aria-label="Slow speed"><b class="stpv" data-speed="0"></b></div><div class="stctl"><button class="sthold" type="button" data-speed="0">Slow</button><button class="stlatch" type="button" data-speed="0" aria-pressed="false" title="Keep running at this speed">⟳ Latch</button></div></div>
                <div class="row"><button id="stlimit" type="button">Set limit</button><button id="streset" type="button">Reset limits</button></div>
              </div>
            </div>
            <div class="ctlslot"></div>
            <button id="strec" class="rec" type="button">● Record</button><div class="stinfo" id="stinfo"></div>
            <div class="outslot"></div>
            <div class="stlive"><label class="check" id="stliverow"><input id="stlive" type="checkbox"> Devices follow without recording</label><span class="gpslot"></span></div>
          </section>
          <section data-part="record">
            <div class="rechead"><h3>Record</h3><div class="kind" role="group" aria-label="Recording type"><button type="button" data-kind="vibrate">〰 Vibrate</button><button type="button" data-kind="stroke">↕ Stroke</button></div></div>
            <div class="pads" id="pads">
              <div class="pad" id="pad1" role="slider" tabindex="0" aria-label="Motor 1 level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="ticks"></div><div class="fill"></div><span class="lab">Motor 1</span><span class="pct">0%</span></div>
              <div class="pad" id="pad2" role="slider" tabindex="0" aria-label="Motor 2 level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div class="ticks"></div><div class="fill"></div><span class="lab">Motor 2</span><span class="pct">0%</span></div>
            </div>
            <div class="ctlslot"></div>
            <button id="rec" class="rec">● Record</button><div class="val" id="timer" style="text-align:center;margin-top:4px"></div>
            <div class="outslot"></div>
            <div class="row" style="margin-top:6px"><label class="check" id="liverow"><input id="live" type="checkbox"> Live pads</label><label class="check"><input id="spring" type="checkbox"> Drop to 0 when released</label><span class="gpslot"></span></div>
            <div class="hint">Touch a pad and slide up or down: the level follows your finger. While recording, the pads drive the devices below live; tick "Live pads" to play with them without recording. Choose a second device (or a device's other motor) to get a second pad.</div>
          </section>
          <section data-part="outputs" id="outhome" class="off">
            <div id="ctlbox">
              <div class="ctltabs" role="tablist"><button type="button" data-ctl="record">● Record</button><button type="button" data-ctl="replay">▶ Replay</button></div>
              <div class="rpbox" id="rpbox" hidden>
                <button id="rppick" type="button" class="rppick">📂 <span id="rpname">Choose a script…</span></button>
                <div class="rppop" id="rppop" hidden><div id="rplist"></div><label class="rpfile">From a file on this device: <input id="rpfile" type="file" accept=".funscript,.json,application/json" multiple></label></div>
                <div class="rpbar" id="rpbar" title="Tap to jump"><i id="rpfill"></i></div>
                <div class="rpinfo" id="rpinfo"></div>
                <div class="rprow"><button id="rpplay" type="button" class="go">▶ Replay</button><select id="rpspeed" aria-label="Replay speed"></select><label class="check"><input id="rploop" type="checkbox"> Loop</label></div>
              </div>
            </div>
            <div class="outbox" id="outbox">
              <label>Devices, and how each follows (used for recording, replay, library and video)</label>
              <div class="outrow" data-row="0"><select class="outt" aria-label="First device"></select><select class="outm" aria-label="How the first device follows"></select><button class="outtake" type="button" hidden>Take control</button></div>
              <div class="outrow" data-row="1"><select class="outt" aria-label="Second device"></select><select class="outm" aria-label="How the second device follows"></select><button class="outtake" type="button" hidden>Take control</button></div>
              <div class="outnote" id="outnote"></div>
            </div>
          </section>
          <section id="takebox" data-part="take" hidden>
            <h3>Current take</h3><div class="take" id="takeinfo"></div>
            <div id="takemodebox" hidden><label>Run as vibration using</label><select id="takemode">${runModeOptions()}</select></div>
            <div class="row" style="margin-top:6px"><button id="takeplay">▶ Play now</button><button id="takestop" class="stop">■ Stop</button><button id="takecode">Copy code</button><button id="takedl">Download</button><button id="takediscard">Discard</button></div>
            <label>Save as</label><div class="row"><input id="name" type="text" placeholder="Name"><button id="save" style="flex:0 0 auto">Save</button></div>
          </section>
          <section data-part="library">
            <h3>Library</h3>
            <select id="saved"></select>
            <div id="libmodebox" hidden><label>Run as vibration using (remembered for this script)</label><select id="libmode">${runModeOptions()}</select></div>
            <div class="row" style="margin-top:8px"><select id="speed"></select><label class="check"><input id="loop" type="checkbox"> Loop</label></div>
            <div class="row" style="margin-top:8px"><button id="play">▶ Play</button><button id="stop" class="stop">■ Stop</button><button id="code">Copy code</button><button id="delete">Delete</button></div>
          </section>
          <section id="videobox" data-part="video">
            <h3>Video sync</h3>
            <div class="hint" style="margin-top:0">The video plays from this phone or computer only. It is never uploaded to Home Assistant.</div>
            <label>Video</label><input id="vfile" type="file" accept="video/*">
            <label>Script</label><select id="vsrc"></select>
            <div id="vfilebox"><input id="vscriptfile" type="file" accept=".funscript,.json,application/json" multiple style="margin-top:6px"></div>
            <video id="video" controls playsinline preload="metadata" hidden></video>
            <div class="hbar" id="hb1" role="slider" tabindex="0" aria-label="Motor 1 level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fill"></div><span class="lab">Motor 1</span><span class="pct">0%</span></div>
            <div class="hbar m2" id="hb2" role="slider" tabindex="0" aria-label="Motor 2 level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div class="fill"></div><span class="lab">Motor 2</span><span class="pct">0%</span></div>
            <div class="vrecrow"><button id="vrec" class="vrec" type="button">● Rec</button><label class="check"><input id="vspring" type="checkbox" checked> Drop to 0 on release</label><span class="vrecinfo" id="vrecinfo"></span></div>
            <div class="stlive"><span class="gpslot"></span></div>
            <div class="row" id="vrecdone" style="margin-top:6px" hidden><button id="vrecuse">Use as take</button><button id="vrecdl">Download .funscript</button><button id="vrecclear" class="stop">Clear</button></div>
            <div class="vstat" id="vstat"></div>
            <div class="row" style="margin-top:8px"><button id="vgo" class="go">▶ Go</button><button id="vstop" class="stop" style="flex:0 0 96px">■ Stop</button></div>
            <label>Sync offset <span id="voffv"></span></label>
            <input id="voff" type="range" min="-1000" max="1000" step="25" value="150">
            <div class="hint">Positive values send each moment slightly early to make up for Bluetooth delay. Pause, seek and playback speed all stay in sync.</div>
            <div class="hint">To make a script for this video: press ● Rec, play the video and drag the slider (position in the Stroke view, intensity in Vibrate). You can pause, scrub back and record a section again; the newer pass replaces it. While a script plays, the slider shows it; hold the slider to take over until you let go.</div>
          </section>
          <section data-part="import">
            <h3>Import</h3>
            <textarea id="paste" placeholder="Paste a funscript, an ogg1: code, or JSON"></textarea>
            <div class="row" style="margin-top:6px"><input id="files" type="file" accept=".funscript,.json,application/json" multiple></div>
            <label>Script type</label>
            <select id="mode"><option value="auto">Automatic (stroke unless it says vibration)</option><option value="stroke">Stroke script (Handy, videos): choose how it vibrates when played</option><option value="vibration">Vibration script: position = intensity</option></select>
            <label class="check" style="margin-top:6px"><input id="invert" type="checkbox"> Inverted</label>
            <div class="row" style="margin-top:8px"><button id="load">Load as current take</button></div>
            <div class="hint">Pick two files to give a two-motor device one track per motor (first file = motor 1).</div>
            <textarea id="codeout" hidden readonly></textarea>
          </section>
          <div class="toast" id="toast"></div>
        </ha-card>`;
      const $ = (id) => this.shadowRoot.getElementById(id);
      this._el = $;
      this._applyParts();
      for (const b of this.shadowRoot.querySelectorAll('.kind button')) b.addEventListener('click', () => this._setRecKind(b.dataset.kind));
      $('device').addEventListener('change', () => {
        this._deviceId = $('device').value;
        this._rememberDevice(this._device || { id: NO_DEVICE, name: '' });
        this._update();
      });
      this._vals = [0, 0];
      this._bindPad($('pad1'), 0);
      this._bindPad($('pad2'), 1);
      $('rec').addEventListener('click', () => (this._recording ? this._stopRecording() : this._startRecording()));
      $('live').addEventListener('change', () => this._setLive($('live').checked));
      $('takeplay').addEventListener('click', () => this._play(this._take));
      $('takestop').addEventListener('click', () => this._stop());
      $('takecode').addEventListener('click', () => this._copy(this._take));
      $('takedl').addEventListener('click', () => this._download(this._take, $('name').value.trim() || (this._take && this._take.metadata && this._take.metadata.title) || 'oggstudio'));
      $('takediscard').addEventListener('click', () => { this._take = null; this._update(); });
      $('save').addEventListener('click', () => this._save());
      $('play').addEventListener('click', () => this._playSaved());
      $('stop').addEventListener('click', () => this._stop());
      $('code').addEventListener('click', () => this._copySaved());
      $('delete').addEventListener('click', () => this._delete());
      $('saved').addEventListener('change', () => this._hass.callService('select', 'select_option', { entity_id: this._studio.saved, option: $('saved').value }));
      $('speed').addEventListener('change', () => this._hass.callService('select', 'select_option', { entity_id: this._studio.speed, option: $('speed').value }));
      $('load').addEventListener('click', () => this._import());
      this._bindStroke();
      this._bindOutputs();
      this._bindReplay();
      this._bindVideo();
      this._bindGamepad();
      this._update();
    }

    // ---------------------------------------------------------- stroke recorder
    _bindStroke() {
      const $ = this._el;
      const load = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; } };
      const lim = load(STROKE_LIMIT_KEY, null);
      const okLim = lim && Number.isFinite(lim.lower) && Number.isFinite(lim.upper) && lim.upper - lim.lower >= 2;
      // pad / touch: speed held on the controller / on screen; drag: finger on the bar.
      this._st = { pos: 50, dir: 1, vel: 0, pad: null, touch: null, latch: null, drag: null, moving: null,
        ...(okLim ? { lower: lim.lower, upper: lim.upper, last: lim.last || null } : { ...STROKE_LIMITS_RESET }) };
      this._stRecording = false;
      $('stlive').addEventListener('change', () => { if ($('stlive').checked) this._stRun(); });
      $('strec').addEventListener('click', () => (this._stRecording ? this._stStop() : this._stStart()));
      $('stlimit').addEventListener('click', () => this._stSetLimit());
      $('streset').addEventListener('click', () => this._stReset());
      const pcts = load(STROKE_SPEED_KEY, null);
      this._stPcts = STROKE_SPEEDS.map((sp, i) => (Array.isArray(pcts) && okPct(pcts[i]) ? pcts[i] : sp.pct));
      // Speed sliders: changes apply straight away, saved when let go.
      for (const r of this.shadowRoot.querySelectorAll('.stpctr')) {
        const i = Number(r.dataset.speed);
        r.value = String(this._stPcts[i]);
        r.title = '';
        r.addEventListener('input', () => { this._stPcts[i] = Number(r.value); this._stShow(); this._gpStatus(); });
        r.addEventListener('change', () => this._gpSave(STROKE_SPEED_KEY, this._stPcts));
      }
      for (const btn of this.shadowRoot.querySelectorAll('.stlatch')) {
        const i = Number(btn.dataset.speed);
        btn.addEventListener('click', () => { this._st.latch = this._st.latch === i ? null : i; this._stRun(); });
      }
      for (const btn of this.shadowRoot.querySelectorAll('.sthold')) {
        const speed = Number(btn.dataset.speed);
        const release = () => { if (this._st.touch === speed) { this._st.touch = null; this._stRun(); } };
        // Pressing a speed takes over from a latched one: it runs while held and stops on release.
        // Holding the latched speed's own button unlatches it (runs while held,
        // stops on release); holding another speed overrides the latch until let go.
        const press = () => { if (this._st.latch === speed) this._st.latch = null; this._st.touch = speed; this._stRun(); };
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(btn, e); press(); });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(type, release);
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
        btn.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } });
        btn.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') release(); });
      }
      const level = (el, e) => { const r = el.getBoundingClientRect(); return Math.min(100, Math.max(0, (1 - (e.clientY - r.top) / r.height) * 100)); };
      // Position lane: the stroker heads for the finger (speed-limited until it gets there).
      const lane = $('stlane');
      lane.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(lane, e);
        lane.classList.add('active');
        this._st.caught = false;
        this._st.drag = level(lane, e);
        this._stRun();
      });
      lane.addEventListener('pointermove', (e) => { if (this._st.drag !== null) this._st.drag = level(lane, e); });
      const laneUp = () => { if (this._st.drag === null) return; this._st.drag = null; lane.classList.remove('active'); this._stRun(); };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) lane.addEventListener(type, laneUp);
      lane.addEventListener('contextmenu', (e) => e.preventDefault());
      lane.addEventListener('keydown', (e) => {
        const steps = { ArrowUp: 2, ArrowDown: -2, PageUp: 10, PageDown: -10 };
        if (e.key in steps) { e.preventDefault(); e.stopPropagation(); this._st.pos = Math.min(100, Math.max(0, this._st.pos + steps[e.key])); this._stMark(); this._stRun(); }
      });
      // Range rail: drag a limit, or the band to move the whole range.
      const rail = $('strail');
      let grab = null;
      rail.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        capture(rail, e);
        rail.classList.add('active');
        const v = level(rail, e);
        grab = railGrab(this._st, v, 22 / rail.getBoundingClientRect().height * 100);   // ~22 px either side of a limit
        if (grab.mode !== 'move') Object.assign(this._st, railDrag(this._st, grab, v));
        this._stShow();
      });
      rail.addEventListener('pointermove', (e) => {
        if (!grab) return;
        Object.assign(this._st, railDrag(this._st, grab, level(rail, e)));
        this._stShow();
      });
      const railUp = () => {
        if (!grab) return;
        // A limit dragged by hand counts as the last one set (for Set limit's pairing).
        if (grab.mode !== 'move') this._st.last = grab.mode;
        grab = null;
        rail.classList.remove('active');
        this._stSaveLimits();
        this._stShow();
      };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) rail.addEventListener(type, railUp);
      rail.addEventListener('contextmenu', (e) => e.preventDefault());
      rail.addEventListener('keydown', (e) => {
        const steps = { ArrowUp: 2, ArrowDown: -2, PageUp: 10, PageDown: -10 };
        if (!(e.key in steps)) return;
        e.preventDefault(); e.stopPropagation();
        Object.assign(this._st, railDrag(this._st, { mode: 'move', off: 0 }, this._st.lower + steps[e.key]));
        this._stSaveLimits();
        this._stShow();
      });
      this._stShow();
    }

    _stSpeed() {
      const st = this._st;
      return st.drag !== null ? null : st.touch ?? st.pad ?? st.latch ?? null;
    }

    // One timer while anything moves, records or follows live; it stops
    // itself when all of that ends.
    _stRun() {
      if (!this._st || this._stTimer || !this.isConnected) { this._stShow(); return; }
      this._stLast = performance.now();
      this._stTimer = setInterval(() => this._stTick(), GP_POLL_MS);
      this._stTick();
    }

    _stTick() {
      const st = this._st;
      const now = performance.now();
      const dt = Math.max(0, now - this._stLast);
      this._stLast = now;
      const before = st.pos;
      const speed = this._stSpeed();
      if (speed !== st.moving) {
        this._stMark(now - dt);       // a hold starts, stops or changes speed here
        st.moving = speed;
      }
      if (speed !== null) st.lastSpeed = speed;
      if (speed !== null) {
        const r = strokeStep(st.pos, st.dir, st.lower, st.upper, strokeVel(this._stPcts[speed]), dt);
        for (const t of r.turns) this._stMark(now - dt + t.frac * dt, t.pos);
        st.pos = r.pos; st.dir = r.dir;
      } else if (st.drag !== null) {
        if (st.caught) st.pos = st.drag;
        else {
          const r = approachStep(st.pos, st.drag, strokeVel(this._stPcts[st.lastSpeed ?? 0]), dt);
          st.pos = r.pos; st.caught = r.caught;
        }
        if (Math.abs(st.pos - before) > 0.5 && now - (this._stDragMark || 0) >= 50) { this._stDragMark = now; this._stMark(now); }
      } else if (this._rp && this._rp.playing) {
        st.pos = this._rpPos();          // replaying: the script moves the bar
      }
      const vel = dt > 0 ? (st.pos - before) / dt * 1000 : 0;
      st.vel = st.vel * 0.6 + vel * 0.4;
      if (speed !== null) st.dir = st.dir || 1;
      this._stLive(now);
      this._stShow();
      const busy = speed !== null || st.drag !== null || this._stRecording || this._el('stlive').checked || Boolean(this._rp && this._rp.playing);
      if (!busy) this._stHalt();
    }

    _stHalt() {
      clearInterval(this._stTimer);
      this._stTimer = null;
      if (this._stOutAt) { this._stOutAt = 0; this._outStop(); }
    }

    // Live feedback: a vibration device follows the stroke using the chosen
    // run mode, sent at most every 100 ms (and refreshed every 500 ms).
    // Live: every output follows the stroke its own way, at most every 100 ms.
    // A vibrator gets an intensity from its run mode; a stroker gets the next
    // limit and how long to take (or the bar position when moved by hand).
    _stLive(now) {
      const replaying = Boolean(this._rp && this._rp.playing);
      const on = this._stRecording || this._el('stlive').checked || replaying;
      if (!on) { if (this._stOutAt) { this._stOutAt = 0; this._outStop(); } return; }
      // Vibrators every 100 ms; a stroker's next target as soon as it turns (every tick).
      const full = !this._stOutAt || now - this._stOutAt >= 100;
      if (full) this._stOutAt = now;
      const st = this._st;
      const speed = this._stSpeed();
      const fromScript = replaying && speed === null && st.drag === null;
      const values = this._outs.map((o, i) => {
        const p = parseTarget(this._outTargetValue(i));
        if (!p || (!full && p.motor !== 'l')) return null;
        if (p.motor === 'l' || o.m === FOLLOW_STROKER) {
          if (p.motor !== 'l') return Math.round(st.pos);   // stroker mode on a vibrator: position
          if (fromScript) return this._rpGoal() || { goal: st.pos, dur: 120 };
          if (speed === null) return { goal: st.pos, dur: 120 };
          const goal = st.dir > 0 ? st.upper : st.lower;
          return { goal, dur: Math.abs(goal - st.pos) / strokeVel(this._stPcts[speed]) };
        }
        return Math.min(100, Math.max(0, liveIntensity(o.m, st.pos, st.vel)));
      });
      this._outApply(values, 0.6);
    }

    _stMark(when, pos) {
      if (!this._stRecording) return;
      const at = Math.max(0, Math.round((when ?? performance.now()) - this._st0));
      const p = Math.round(pos ?? this._st.pos);
      const acts = this._stActs;
      const last = acts[acts.length - 1];
      if (last && at <= last.at) last.pos = p; else acts.push({ at, pos: p });
    }

    _stStart() {
      if (this._stRecording) return;
      this._stRecording = true;
      this._st0 = performance.now();
      this._stActs = [];
      this._stMark(this._st0);
      this._stRun();
      this._toast('Recording: hold a speed to stroke.');
    }

    _stStop() {
      if (!this._stRecording) return;
      this._stMark();
      this._stRecording = false;
      const acts = this._stActs;
      this._stActs = [];
      if (acts.length < 2 || acts[acts.length - 1].at < 200) { this._toast('Nothing recorded.'); this._stShow(); return; }
      this._take = { version: '1.0', inverted: false, range: 100, actions: acts, metadata: { creator: 'OggStudio', type: 'stroke' } };
      const m = this._outs[0].m;
      this._el('takemode').value = RUN_MODES[m] ? m : RUN_MODE_DEFAULT;
      this._toast(`Recorded ${fmt(duration(this._take))} of strokes. Save it below, or download the .funscript for a Handy.`);
      this._update();
      this._stRun();   // stops live feedback if nothing else needs it
    }

    _stSetLimit() {
      const st = this._st;
      const next = strokeSetLimit(st, st.pos);
      if (!next) { this._toast('That is where the other limit is: move first, then set the limit.'); return; }
      Object.assign(st, next);
      this._stSaveLimits();
      this._toast(`${next.last === 'upper' ? 'Upper' : 'Lower'} limit set: range ${st.lower}–${st.upper}.`);
      this._stShow();
    }

    _stSaveLimits() {
      const st = this._st;
      this._gpSave(STROKE_LIMIT_KEY, { lower: st.lower, upper: st.upper, last: st.last });
    }

    _stReset() {
      Object.assign(this._st, STROKE_LIMITS_RESET);
      this._gpSave(STROKE_LIMIT_KEY, null);
      this._toast('Limits reset: full range 0–100.');
      this._stShow();
    }

    _stShow() {
      if (!this._el || !this._st) return;
      const $ = this._el;
      const st = this._st;
      const pos = Math.round(st.pos);
      for (const id of ['stband', 'stshade']) { $(id).style.top = `${100 - st.upper}%`; $(id).style.height = `${st.upper - st.lower}%`; }
      $('stpos').style.bottom = `${st.pos}%`;
      // Limit numbers sit outside the band, so they stay readable on a narrow range.
      $('stup').style.top = st.upper > 90 ? `calc(${100 - st.upper}% + 6px)` : `calc(${100 - st.upper}% - 18px)`; $('stup').textContent = String(st.upper);
      $('stlo').style.bottom = st.lower < 10 ? `calc(${st.lower}% + 6px)` : `calc(${st.lower}% - 18px)`; $('stlo').textContent = String(st.lower);
      $('stpct').textContent = String(pos);
      $('stlane').setAttribute('aria-valuenow', String(pos));
      $('strail').setAttribute('aria-valuetext', `range ${st.lower} to ${st.upper}`);
      const speed = this._stSpeed();
      for (const b of this.shadowRoot.querySelectorAll('.sthold')) b.classList.toggle('on', Number(b.dataset.speed) === speed);
      for (const b of this.shadowRoot.querySelectorAll('.stpv')) { const t = `${this._stPcts[Number(b.dataset.speed)]}%`; if (b.textContent !== t) b.textContent = t; }
      for (const b of this.shadowRoot.querySelectorAll('.stlatch')) {
        const on = Number(b.dataset.speed) === st.latch;
        if (b.classList.contains('on') !== on) { b.classList.toggle('on', on); b.textContent = on ? '■ Latched' : '⟳ Latch'; b.setAttribute('aria-pressed', String(on)); }
      }
      $('strec').textContent = this._stRecording ? '■ Stop recording' : '● Record';
      $('strec').classList.toggle('on', this._stRecording);
      const bits = [`Range ${st.lower}–${st.upper}`];
      if (speed !== null) bits.push(`${STROKE_SPEEDS[speed].name} ${this._stPcts[speed]}%${st.latch === speed && st.touch === null && st.pad === null ? ' (latched)' : ''}`);
      if (this._stRecording) bits.push(`● ${fmt(performance.now() - this._st0)}`);
      if (this._outs && !this._outs.some((o, i) => parseTarget(this._outTargetValue(i)))) bits.push('no device: recording only');
      const text = bits.join(' · ');
      if ($('stinfo').textContent !== text) $('stinfo').textContent = text;
    }

    // ---------------------------------------------------------- game controller
    _bindGamepad() {
      const $ = this._el;
      const parts = this._baseParts;
      $('gp').hidden = !(parts.includes('record') || parts.includes('video') || parts.includes('stroke'));
      this._gpLearning = null;
      this._gpStatusHtml = null;
      const load = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; } };
      this._gpMaps = {};
      for (const [name, prof] of Object.entries(GP_PROFILES)) {
        const map = load(prof.mapKey, null);
        this._gpMaps[name] = map && typeof map === 'object' ? gpBuildMap(map, prof.defaults) : { ...prof.defaults };
      }
      const speed = Number(load(GP_SPEED_KEY, GP_SPEED_DEFAULT));
      this._gpSpeed = Number.isInteger(speed) && speed >= 0 && speed < GP_SPEEDS.length ? speed : GP_SPEED_DEFAULT;
      $('gpon').checked = load(GP_ON_KEY, false) === true;
      $('gpon').addEventListener('change', () => { this._gpSave(GP_ON_KEY, $('gpon').checked); gpOwner = this; this._gpRun(); this._gpStatus(); });
      $('gplearnbtn').addEventListener('click', () => this._gpLearnStart());
      $('gpskip').addEventListener('click', () => this._gpLearnSkip());
      $('gpreset').addEventListener('click', () => { this._gpSave(this._gpProf.mapKey, null); this._gpMap = { ...this._gpProf.defaults }; this._gpLearnEnd('Controller: default controls restored.'); });
      $('gpcancel').addEventListener('click', () => this._gpLearnEnd(''));
      this._gpStatus();
      this._gpRun();
    }

    connectedCallback() { this._gpAttach(); }

    _gpAttach() {
      if (this._gpHandlers) return;
      const typing = (e) => {
        const t = e.composedPath ? e.composedPath()[0] : e.target;
        return Boolean(t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || (t.tagName === 'INPUT' && t.type !== 'checkbox')));
      };
      const names = (e) => [e.code, e.key].filter(Boolean);
      const h = {
        keydown: (e) => {
          if (!this._el || typing(e)) return;
          if (this._gpLearning) {
            if (e.key === 'Tab') return;
            e.preventDefault(); e.stopPropagation();
            if (e.repeat) return;
            // On Android a gamepad's D-pad and buttons often also arrive as
            // keys; with a gamepad present, learn from the gamepad only.
            if (this._gpPad()) { this._gpLearning.keys = (this._gpLearning.keys || 0) + 1; if (this._gpLearning.keys <= 3) this._gpLog(`key ignored while learning (gamepad present): code=${e.code} key=${e.key}`); return; }
            this._gpLearnKey(e.code || e.key);
            return;
          }
          if (!this._el('gpon').checked || !this._gpUsable() || !this._gpIsOwner()) return;
          const n = names(e);
          if (!Object.values(this._gpMap).some((binds) => binds.some((b) => b.k !== undefined && n.includes(b.k)))) return;
          e.preventDefault(); e.stopPropagation();
          // With a gamepad present its own readings count; key echoes of its
          // buttons (Android) would otherwise fire the wrong action.
          if (this._gpPad()) return;
          n.forEach((k) => this._gpKeys.add(k));
          this._gpRun();
        },
        keyup: (e) => { names(e).forEach((k) => this._gpKeys.delete(k)); },
        blur: () => this._gpKeys.clear(),
        connected: (e) => {
          if (!this._el || !this._gpUsable()) return;
          if (!this._el('gpon').checked) { this._el('gpon').checked = true; this._gpSave(GP_ON_KEY, true); }
          this._toast(`Controller connected: ${e.gamepad && e.gamepad.id ? e.gamepad.id : 'game controller'}`);
          if (gpOwner === this || !gpOwner) this._gpLogPads();
          this._gpRun();
          this._gpStatus();
        },
        disconnected: () => { this._gpFloat = [null, null]; this._gpStatus(); },
      };
      window.addEventListener('keydown', h.keydown, true);
      window.addEventListener('keyup', h.keyup, true);
      window.addEventListener('blur', h.blur);
      window.addEventListener('gamepadconnected', h.connected);
      window.addEventListener('gamepaddisconnected', h.disconnected);
      this._gpHandlers = h;
      this._gpRun();
    }

    _gpDetach() {
      const h = this._gpHandlers;
      if (h) {
        window.removeEventListener('keydown', h.keydown, true);
        window.removeEventListener('keyup', h.keyup, true);
        window.removeEventListener('blur', h.blur);
        window.removeEventListener('gamepadconnected', h.connected);
        window.removeEventListener('gamepaddisconnected', h.disconnected);
      }
      this._gpHandlers = null;
      clearInterval(this._gpTimer);
      this._gpTimer = null;
      this._gpKeys.clear();
      if (gpOwner === this) gpOwner = null;
    }

    _gpSave(key, value) {
      try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
    }

    _gpUsable() { return Boolean(this._el && this.isConnected && !this._el('gp').hidden); }

    _gpIsOwner() {
      if (gpOwner && gpOwner !== this && gpOwner._gpUsable() && gpOwner._el('gpon').checked) return false;
      gpOwner = this;
      return true;
    }

    _gpPad() {
      let pads = [];
      try { pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; this._gpBlocked = false; } catch (_) { this._gpBlocked = true; }
      this._gpPrevPressed = this._gpPrevPressed || {};
      for (const p of pads) {
        if (!p || !p.connected) continue;
        const now = gpPressed(p);
        const before = this._gpPrevPressed[p.index];
        if (before && now.some((i) => !before.includes(i))) this._gpActive = p.index;   // a new press
        this._gpPrevPressed[p.index] = now;
      }
      this._gpPadCount = pads.filter((p) => p && p.connected).length;
      return gpChoosePad(pads, this._gpActive);
    }

    // Learn controls reports what it sees to the Home Assistant log
    // (Settings > System > Logs), so a controller's quirks can be diagnosed.
    _gpLog(message) {
      if (!this._hass) return;
      this._hass.callService('system_log', 'write', { message: `OggStudio controller: ${message}`, level: 'warning', logger: 'oggstudio.card' }, undefined, false).catch(() => {});
    }

    _gpLogPads() {
      let pads = [];
      try { pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch (_) { /* blocked */ }
      const live = pads.filter((p) => p && p.connected);
      this._gpLog(`${live.length} gamepad(s): ${live.map((p) => gpRaw(p)).join(' || ') || 'none'} · chosen #${this._gpPad() ? this._gpPad().index : '-'} · secure=${window.isSecureContext} · ${navigator.userAgent}`);
    }

    _gpTarget() { return gpTargetFor(this._parts, Boolean(this._vurl)); }

    // The stroke recorder has its own controls (and its own learned map).
    get _gpProfName() { return this._gpLearning ? this._gpLearning.prof : (this._gpTarget() === 'stroke' ? 'stroke' : 'level'); }
    get _gpProf() { return GP_PROFILES[this._gpProfName]; }
    get _gpMap() { return this._gpMaps[this._gpProfName]; }
    set _gpMap(map) { this._gpMaps[this._gpProfName] = map; }

    // Polls the controller every GP_POLL_MS while it is on (or learning).
    // A timer rather than animation frames: those stall in some web views.
    _gpRun() {
      if (this._gpTimer || !this._el || !this.isConnected) return;
      this._gpLast = performance.now();
      this._gpTimer = setInterval(() => {
        if (!this._el || !this.isConnected || (!this._el('gpon').checked && !this._gpLearning)) {
          clearInterval(this._gpTimer); this._gpTimer = null; this._gpKeys.clear();
          return;
        }
        const now = performance.now();
        const dt = now - this._gpLast;
        this._gpLast = now;
        this._gpTick(dt);
      }, GP_POLL_MS);
    }

    _gpTick(dt) {
      const pad = this._gpPad();
      this._gpPadId = pad ? pad.id : '';
      if (this._gpLearning) { this._gpLearnPoll(pad); return; }
      if (!this._gpUsable() || !this._gpIsOwner()) return;
      const s = gpRead(this._gpMap, pad, this._gpKeys);
      const pressed = (a) => s[a] > 0.5 && !(this._gpPrev[a] > 0.5);
      if (this._gpProfName === 'stroke') {
        if (pressed('rec')) this._gpRec();
        if (pressed('limit')) this._stSetLimit();
        if (pressed('reset')) this._stReset();
        const held = s.fast > 0.5 ? 2 : s.med > 0.5 ? 1 : s.slow > 0.5 ? 0 : null;
        if (held !== this._st.pad) { if (held !== null && held === this._st.latch) this._st.latch = null; this._st.pad = held; this._stRun(); }
        this._gpPrev = s;
        this._gpStatus();
        return;
      }
      if (pressed('right')) this._gpSetSpeed(1);
      if (pressed('left')) this._gpSetSpeed(-1);
      if (pressed('motor')) this._gpCycleMotor();
      if (pressed('rec')) this._gpRec();
      const target = this._gpTarget();
      if (target && pressed('zero')) {
        this._gpFloat = [null, null];
        this._gpApply(target, () => 0);
      } else if (target && (s.up || s.down)) {
        const speed = GP_SPEEDS[this._gpSpeed];
        this._gpApply(target, (v, i) => (this._gpFloat[i] = gpStep(this._gpFloat[i] ?? v, s.up, s.down, speed, dt)));
      } else {
        this._gpFloat = [null, null];
      }
      this._gpPrev = s;
      this._gpStatus();
    }

    _gpMotors() {
      if (this._gpTarget() === 'video' || !this._twoPads) return [0];
      return this._gpMotor === 2 ? [0, 1] : [this._gpMotor];
    }

    _gpApply(target, fn) {
      const motors = this._gpMotors();
      if (target === 'video') {
        if (!this._vrec) { this._gpHint('Controller: press record first to record against the video'); return; }
        // The video tick (every 100 ms) samples and sends the bars.
        for (const i of motors) { this._hvals[i] = Math.round(Math.min(100, Math.max(0, fn(this._hvals[i], i)))); this._showHBar(i, this._hvals[i]); }
      } else {
        for (const i of motors) this._setPad(i, fn(this._vals[i], i));   // the live timer sends it
      }
    }

    _gpHint(text) {
      if (this._gpHinted === text) return;
      this._gpHinted = text;
      this._toast(text);
      clearTimeout(this._gpHintTimer);
      this._gpHintTimer = setTimeout(() => { this._gpHinted = null; }, 4000);
    }

    _gpSetSpeed(delta) {
      this._gpSpeed = Math.min(GP_SPEEDS.length - 1, Math.max(0, this._gpSpeed + delta));
      this._gpSave(GP_SPEED_KEY, this._gpSpeed);
    }

    _gpCycleMotor() {
      if (this._gpTarget() === 'video' || !this._twoPads) return;
      this._gpMotor = (this._gpMotor + 1) % 3;
      this._gpFloat = [null, null];
    }

    _gpRec() {
      const $ = this._el;
      const target = this._gpTarget();
      if ((target === 'stroke' || target === 'record') && this._ctl === 'replay') {
        this._rpToggle();
      } else if (target === 'stroke') {
        if (this._stRecording) this._stStop(); else this._stStart();
      } else if (target === 'video') {
        this._vrecToggle();
        const video = $('video');
        if (this._vrec && video.paused) this._videoGo();
        else if (!this._vrec && !video.paused) video.pause();
      } else if (target === 'record') {
        if ($('rec').disabled) { this._toast('The device is not connected'); return; }
        if (this._recording) this._stopRecording(); else this._startRecording();
      }
    }

    _gpStatus() {
      if (!this._el) return;
      const $ = this._el;
      const open = $('gpon').checked || Boolean(this._gpLearning);
      if ($('gpmore').hidden === open) { $('gpmore').hidden = !open; $('gp').classList.toggle('on', open); }
      let html = '';
      const stroke = this._gpProfName === 'stroke';
      if (this._gpLearning) html = '';
      else if (!$('gpon').checked) html = stroke ? 'Hold a speed to stroke, set and reset limits, record' : 'Up/down = level, left/right = speed, A = record';
      else if (stroke) {
        const st = this._st;
        const sp = this._stSpeed();
        const bits = [sp !== null && sp !== undefined ? `<b>${STROKE_SPEEDS[sp].name} ${this._stPcts[sp]}%</b>` : 'hold a speed to stroke'];
        if (this._gpPadId) bits.push(esc(this._gpPadId.replace(/\s*\(.*$/, '').slice(0, 28)) + (this._gpPadCount > 1 && this._gpActive === undefined ? ` (1 of ${this._gpPadCount}: press a button to choose)` : ''));
        else if (this._gpBlocked || !window.isSecureContext) bits.push('no gamepad: this page is not HTTPS, so only keyboard-mode controllers work');
        else bits.push('press a button on the controller');
        html = bits.join(' · ');
      } else {
        const bits = [`Speed <b>${this._gpSpeed + 1}/${GP_SPEEDS.length}</b> (${GP_SPEEDS[this._gpSpeed]}%/s)`];
        if (this._gpTarget() !== 'video' && this._twoPads) bits.push(['Pad 1', 'Pad 2', 'Both pads'][this._gpMotor]);
        const target = this._gpTarget();
        bits.push(target === 'video' ? '→ video' : target === 'record' ? '→ pads' : '');
        if (this._gpPadId) bits.push(esc(this._gpPadId.replace(/\s*\(.*$/, '').slice(0, 28)) + (this._gpPadCount > 1 && this._gpActive === undefined ? ` (1 of ${this._gpPadCount}: press a button to choose)` : ''));
        else if (this._gpBlocked || !window.isSecureContext) bits.push('no gamepad: this page is not HTTPS, so only keyboard-mode controllers work');
        else bits.push('press a button on the controller');
        html = bits.filter(Boolean).join(' · ');
      }
      if (this._gpStatusHtml !== html) { this._gpStatusHtml = html; $('gpstat').innerHTML = html; }
    }

    // Learn controls: (1) hands off while axes are measured, (2) press the
    // button for Record, (3) for each other control: hold it, press Record.
    _gpLearnStart() {
      const $ = this._el;
      if (!$('gpon').checked) { $('gpon').checked = true; this._gpSave(GP_ON_KEY, true); }
      this._gpLearning = { prof: this._gpProfName, phase: 'wake', learned: {}, step: 0, samples: [], cal: null, recBtn: -1, recKey: null, wait: true, last: '' };
      $('gplearn').hidden = false; $('gplearnrow').hidden = false; $('gpraw').hidden = false; $('gplearnbtn').hidden = true;
      this._gpLog('learn started');
      this._gpLogPads();
      this._gpStatus();
      this._gpLearnShow();
      this._gpRun();
    }

    _gpLearnShow() {
      const L = this._gpLearning;
      if (!L || !this._el) return;
      const recName = L.recKey ? `key ${L.recKey}` : `button ${L.recBtn}`;
      const text = {
        wake: 'Press any button on the controller to wake it, then let go. (Keyboard-mode controller: press the key you want for Record.)',
        rest: 'Hands off the controller for a moment...',
        rec: 'Press the button you want for Record start/stop.',
        hold: `${L.step + 1}/${this._gpProf.hold.length}: hold ${this._gpProf.labels[this._gpProf.hold[L.step]].toUpperCase()}, then press Record (${recName}) to confirm. Nothing held, or Skip = keep the default.`,
      }[L.phase];
      const t = (L.last ? `✓ ${L.last}. ` : '') + text;
      if (this._el('gplearn').textContent !== t) this._el('gplearn').textContent = t;
    }

    _gpLearnPoll(pad) {
      const L = this._gpLearning;
      L.ticks = (L.ticks || 0) + 1;
      if (L.ticks % 5 === 0 && this._el) this._el('gpraw').textContent = `${gpRaw(pad)}${this._gpPadCount > 1 ? ` (of ${this._gpPadCount} gamepads)` : ''}`;
      if (L.phase === 'wake') {
        if (pad) { L.phase = 'rest'; L.samples = []; L.restPressed = null; this._gpLearnShow(); }
        return;
      }
      if (!pad) return;
      if (L.phase === 'rest') {
        // Buttons must stay the same for the whole hands-off run; any that
        // are down throughout are stuck and ignored from now on.
        const pressed = gpPressed(pad).join(',');
        if (pressed !== L.restPressed) { L.restPressed = pressed; L.samples = []; }
        L.samples.push([...pad.axes]);
        if (L.samples.length >= GP_REST_SAMPLES) {
          L.cal = gpCalibrate(L.samples);
          L.cal.stuck = gpPressed(pad);
          L.padIndex = pad.index;
          L.phase = 'rec'; L.wait = true;
          this._gpLog(`calibrated pad #${pad.index}: rest [${L.cal.rest.map((v) => v.toFixed(2)).join(' ')}] jitter [${L.cal.noise.map((v) => v.toFixed(2)).join(' ')}] stuck buttons [${L.cal.stuck.join(',')}]`);
          this._gpLearnShow();
        }
        return;
      }
      const stuck = L.cal ? L.cal.stuck : [];
      if (L.phase === 'rec') {
        const b = gpFirstButton(pad, -1, stuck);
        if (L.wait) { if (b < 0) L.wait = false; return; }
        if (b >= 0) { this._gpLog(`record button: ${gpRaw(pad)}`); this._gpLearnSetRec({ b }); }
        return;
      }
      // hold: confirm on the rising edge of the Record button.
      const recDown = L.recBtn >= 0 && !stuck.includes(L.recBtn) && Boolean(pad.buttons[L.recBtn] && pad.buttons[L.recBtn].pressed);
      if (L.wait) { if (!recDown) L.wait = false; return; }
      if (recDown) {
        const bind = gpPickInput(pad, L.cal, L.recBtn);
        this._gpLog(`${this._gpProf.hold[L.step]} confirmed -> ${gpDescribe(bind)} · ${gpRaw(pad)}`);
        this._gpLearnNext(bind);
      }
    }

    _gpLearnSetRec(bind) {
      const L = this._gpLearning;
      L.learned.rec = [bind];
      if (bind.b !== undefined) L.recBtn = bind.b; else L.recKey = bind.k;
      L.last = `Record = ${gpDescribe(bind)}`;
      L.phase = 'hold'; L.step = 0; L.wait = true;
      this._gpLearnShow();
    }

    // Keys while learning: a key for Record (keyboard-mode pads), the Record
    // key confirms what is held, any other key binds straight away.
    _gpLearnKey(k) {
      const L = this._gpLearning;
      if (L.phase !== 'hold') { this._gpLearnSetRec({ k }); return; }
      if (k === L.recKey) this._gpLearnNext(gpPickInput(this._gpPad(), L.cal, L.recBtn));
      else this._gpLearnNext({ k });
    }

    _gpLearnSkip() {
      const L = this._gpLearning;
      if (!L) return;
      if (L.phase === 'hold') { this._gpLearnNext(null); return; }
      // Record skipped: keep the default (button 0) and confirm with it.
      L.recBtn = 0; L.last = 'Record = button 0 (default)';
      if (!L.cal && L.samples.length) { L.cal = gpCalibrate(L.samples); L.cal.stuck = []; }
      L.phase = 'hold'; L.step = 0; L.wait = true;
      this._gpLearnShow();
    }

    _gpLearnNext(bind) {
      const L = this._gpLearning;
      if (!L || L.phase !== 'hold') return;
      const prof = this._gpProf;
      const action = prof.hold[L.step];
      if (bind) {
        const same = JSON.stringify(bind);
        for (const a of Object.keys(L.learned)) L.learned[a] = L.learned[a].filter((b) => JSON.stringify(b) !== same);
        L.learned[action] = [bind];
      }
      L.last = `${prof.labels[action]} = ${gpDescribe(bind)}`;
      L.wait = true;
      L.step += 1;
      if (L.step < prof.hold.length) { this._gpLearnShow(); return; }
      this._gpSave(prof.mapKey, L.learned);
      this._gpMap = gpBuildMap(L.learned, prof.defaults);
      this._gpLog(`learn finished: ${JSON.stringify(L.learned)}`);
      this._gpLearnEnd('Controller: controls saved for this browser.');
    }

    _gpLearnEnd(message) {
      const $ = this._el;
      const map = this._gpMap;
      this._gpLearning = null;
      $('gplearn').hidden = true; $('gplearnrow').hidden = true; $('gpraw').hidden = true; $('gplearnbtn').hidden = false;
      // Treat everything as held so nothing fires until it is released.
      this._gpPrev = Object.fromEntries([...GP_ACTIONS, ...ST_ACTIONS, ...Object.keys(map)].map((a) => [a, 1]));
      this._gpKeys.clear();
      this._toast(message);
      this._gpStatus();
    }

    // ---------------------------------------------------------- video sync
    _bindVideo() {
      const $ = this._el;
      const video = $('video');
      let offset = 150;
      try { const saved = Number(localStorage.getItem(VIDEO_OFFSET_KEY)); if (Number.isFinite(saved) && localStorage.getItem(VIDEO_OFFSET_KEY) !== null) offset = saved; } catch (_) { /* private mode */ }
      $('voff').value = String(offset);
      const showOffset = () => { $('voffv').textContent = `${Number($('voff').value) > 0 ? '+' : ''}${$('voff').value} ms`; };
      showOffset();
      $('voff').addEventListener('input', () => {
        showOffset();
        try { localStorage.setItem(VIDEO_OFFSET_KEY, $('voff').value); } catch (_) { /* private mode */ }
        this._videoSend(true);
      });
      $('vfile').addEventListener('change', () => {
        const file = $('vfile').files[0];
        this._vname = file ? file.name.replace(/\.[^.]+$/, '') : '';
        this._videoHalt();
        if (this._vrec) this._vrecToggle();
        if (this._vrecHas()) this._vrecReset();
        if (this._vurl) URL.revokeObjectURL(this._vurl);
        this._vurl = file ? URL.createObjectURL(file) : null;   // local only, never uploaded
        video.hidden = !file;
        if (file) { video.src = this._vurl; video.load(); } else { video.removeAttribute('src'); }
        this._videoStatus();
      });
      $('vsrc').addEventListener('change', () => this._loadVideoScript());
      $('vscriptfile').addEventListener('change', () => this._loadVideoScript());
      $('vgo').addEventListener('click', () => this._videoGo());
      $('vstop').addEventListener('click', () => { video.pause(); try { video.currentTime = 0; } catch (_) { /* not loaded */ } this._videoHalt(); });
      video.addEventListener('play', () => this._videoRun());
      video.addEventListener('playing', () => this._videoRun());
      video.addEventListener('pause', () => this._videoHalt());
      video.addEventListener('ended', () => this._videoHalt());
      video.addEventListener('emptied', () => this._videoHalt());
      video.addEventListener('seeked', () => this._videoSend(true));
      video.addEventListener('timeupdate', () => this._videoStatus());
      video.addEventListener('loadedmetadata', () => this._videoStatus());
      // Recording against the video clock.
      this._hvals = [0, 0];
      this._vpasses = [[], []];
      this._bindHBar($('hb1'), 0);
      this._bindHBar($('hb2'), 1);
      video.addEventListener('seeking', () => this._vrecBreak());
      $('vrec').addEventListener('click', () => this._vrecToggle());
      $('vrecuse').addEventListener('click', () => this._vrecUse());
      $('vrecdl').addEventListener('click', () => this._vrecDownload());
      $('vrecclear').addEventListener('click', () => { if (confirm('Discard this recording?')) this._vrecReset(); });
    }

    async _loadVideoScript() {
      const $ = this._el;
      const fromFile = $('vsrc').value === '';
      $('vfilebox').hidden = !fromFile;
      this._vraw = null;
      try {
        if (fromFile) {
          const files = [...$('vscriptfile').files];
          if (!files.length) { this._vscript = null; this._videoStatus(); return; }
          const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
          const first = parsed[0];
          if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
          this._vraw = normalise(first, fileKind(files[0].name, 'auto'), Boolean(first.inverted));
          this._vscriptName = files[0].name;
        } else if ($('vsrc').value === TAKE_SRC) {
          if (!this._take) { this._vscript = null; this._videoStatus(); return; }
          this._vraw = this._take;
          this._vscriptName = 'Current take';
        } else {
          this._vraw = await this._getSaved($('vsrc').value);
          this._vscriptName = $('vsrc').value;
        }
        this._vscript = this._vraw;      // mapped per device as it plays
        this._vconvs = {};
        if (!fromFile && $('vsrc').value !== TAKE_SRC) this._useRemembered($('vsrc').value, this._vraw);
        this._outRender();
        this._videoSend(true);
      } catch (e) {
        this._vscript = null;
        this._toast('Could not load the script: ' + (e.message || e));
      }
      this._videoStatus();
    }


    // Is the outputs box in a recorder on this card? Then the video drives
    // those devices (with their follow modes); else the playback device.
    get _outsHere() { const box = this._el && this._el('outbox'); return Boolean(box && box.parentElement && box.parentElement.classList.contains('outslot')); }

    // Video slider value: what it records, or what the script is doing now
    // (position for a stroke script in the stroke view, else intensity).
    _videoValue() {
      if (this._vrec || this._hbActive) return this._hvals[0];
      const video = this._el('video');
      const ms = video.currentTime * 1000 + Number(this._el('voff').value || 0);
      if (!this._vraw) return 0;
      if (this._strokeKindRec && isStroke(this._vraw)) return sampleAt(this._vraw.actions, ms);
      return this._mapScript(this._vraw, ms, this._vconvs || (this._vconvs = {}))[0];
    }

    get _strokeKindRec() { return this._recKind === 'stroke'; }

    // Drive the follow-along devices from the video (outputs on this card).
    _videoOut() {
      const now = performance.now();
      const value = this._videoValue();
      const dt = now - (this._vOutAt || now);
      const vel = dt > 0 ? (value - (this._vOutPos ?? value)) / dt * 1000 : 0;
      this._vOutAt = now; this._vOutPos = value;
      this._vVel = (this._vVel || 0) * 0.6 + vel * 0.4;
      const video = this._el('video');
      const ms = video.currentTime * 1000 + Number(this._el('voff').value || 0);
      const script = !(this._vrec || this._hbActive) && this._vraw && isStroke(this._vraw);
      if (this._strokeKindRec) {
        const values = this._outs.map((o, i) => {
          const p = parseTarget(this._outTargetValue(i));
          if (!p) return null;
          if (p.motor === 'l') {
            const next = script && nextAction(this._vraw.actions, ms);
            return next ? { goal: next.pos, dur: (next.at - ms) / (video.playbackRate || 1) } : { goal: value, dur: 120 };
          }
          if (o.m === FOLLOW_STROKER) return value;
          return Math.min(100, Math.max(0, liveIntensity(o.m, value, this._vVel)));
        });
        this._outApply(values, 0.6);
        // The stroke bar shows it too (unless you are moving it).
        const st = this._st;
        if (st && st.drag === null && this._stSpeed() === null) { st.pos = value; this._stShow(); }
      } else {
        const held = this._vrec || this._hbActive;
        if (held) {
          // The slider, mapped per device like the pads.
          const h = this._hvals[0];
          for (const i of [0, 1]) if (!this._padActive || !this._padActive[i]) this._setPad(i, h);
          this._outApply([0, 1].map((i) => (i && !this._twoPads ? null : this._mapLive(i, h, this._vVel))), 0.6);
          return;
        }
        const vals = this._mapScript(this._vraw || { actions: [] }, ms, this._vconvs || (this._vconvs = {}));
        for (const i of [0, 1]) if (!this._padActive || !this._padActive[i]) this._setPad(i, vals[i]);
        const out = [0, 1].map((i) => {
          if (i && !this._twoPads) return null;
          const p = parseTarget(this._outTargetValue(i));
          if (p && p.motor === 'l') {
            const next = this._vraw && nextAction(this._vraw.actions, ms);
            return next ? { goal: next.pos, dur: (next.at - ms) / (video.playbackRate || 1) } : { goal: this._vals[i], dur: 150 };
          }
          return this._vals[i];
        });
        this._outApply(out, 0.6);
      }
    }

    _videoSend(force) {
      const video = this._el && this._el('video');
      if (!this._vsyncTimer || !video || video.paused) { this._videoStatus(); return; }
      if (this._vrec) this._vrecSample();
      if (!this._vrec && !this._hbActive) this._showHBar(0, this._videoValue());
      this._videoOut();
      this._videoStatus();
    }

    _videoRun() {
      if (this._vsyncTimer || !(this._vscript || this._vrec)) return;
      if (this._rp) this._rpStop();
      if (this._live) { this._el('live').checked = false; this._setLive(false); }
      this._vlast = null;
      this._vsentAt = 0;
      this._vsyncTimer = setInterval(() => this._videoSend(false), VIDEO_TICK_MS);
      this._videoSend(true);
    }

    _videoHalt() {
      this._vrecBreak();
      if (!this._vsyncTimer) return;
      clearInterval(this._vsyncTimer);
      this._vsyncTimer = null;
      this._vlast = null;
      this._outStop();
      this._videoStatus([0, 0]);
    }

    _showHBar(index, value) {
      const bar = this._el('hb' + (index + 1));
      const v = Math.round(Math.min(100, Math.max(0, value)));
      bar.querySelector('.fill').style.width = v + '%';
      bar.querySelector('.pct').textContent = v + '%';
      bar.setAttribute('aria-valuenow', String(v));
    }

    _setHBar(index, value) {
      this._hvals[index] = Math.round(Math.min(100, Math.max(0, value)));
      this._showHBar(index, this._hvals[index]);
      if (this._vrec || this._hbActive) this._videoSend(false);
    }

    _bindHBar(bar, index) {
      let active = false;
      const fromEvent = (event) => {
        const rect = bar.getBoundingClientRect();
        this._setHBar(index, ((event.clientX - rect.left) / rect.width) * 100);
      };
      bar.addEventListener('pointerdown', (event) => {
        // Record with it, or take over a script that is playing (until let go).
        const playing = Boolean(this._vsyncTimer && this._vscript);
        if (!this._vrec && !playing) { this._toast('Press ● Rec first to record with the slider (or play a script to take it over)'); return; }
        event.preventDefault();
        active = true;
        if (!this._vrec) this._hbActive = true;
        bar.classList.add('active');
        capture(bar, event);
        fromEvent(event);
      });
      bar.addEventListener('pointermove', (event) => { if (active) fromEvent(event); });
      const release = () => {
        if (!active) return;
        active = false;
        bar.classList.remove('active');
        if (this._hbActive) { this._hbActive = false; this._videoSend(true); return; }   // back to the script
        if (this._el('vspring').checked) this._setHBar(index, 0);
      };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) bar.addEventListener(type, release);
      bar.addEventListener('contextmenu', (event) => event.preventDefault());
      bar.addEventListener('keydown', (event) => {
        if (!this._vrec) return;
        const steps = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 20, PageDown: -20 };
        if (event.key in steps) { this._setHBar(index, this._hvals[index] + steps[event.key]); event.preventDefault(); }
        else if (event.key === 'Home') { this._setHBar(index, 0); event.preventDefault(); }
        else if (event.key === 'End') { this._setHBar(index, 100); event.preventDefault(); }
      });
    }

    _vrecToggle() {
      const $ = this._el;
      if (!this._vurl) { this._toast('Choose a video first'); return; }
      this._vrec = !this._vrec;
      if (!this._vrec) this._vrecBreak();
      this._vcur = null;
      $('vrec').classList.toggle('on', this._vrec);
      $('vrec').textContent = this._vrec ? '■ Stop rec' : '● Rec';
      for (const id of ['hb1', 'hb2']) $(id).classList.toggle('rec', this._vrec);
      if (this._vrec) {
        this._setHBar(0, 0); this._setHBar(1, 0);
        this._toast('Recording: play the video and drag the bars.');
        if (!$('video').paused) { this._videoHalt(); this._videoRun(); }
      } else {
        this._toast(this._vrecHas() ? 'Recording stopped. Use it as a take, download it, or press ● Rec to add more.' : '');
        const video = $('video');
        if (!video.paused) { clearInterval(this._vsyncTimer); this._vsyncTimer = null; this._videoRun(); }
      }
      this._videoStatus();
    }

    // Sample the bars at the video's own time (only while it plays).
    _vrecSample() {
      const video = this._el('video');
      if (!this._vrec || video.paused || video.seeking) return;
      const at = Math.round(video.currentTime * 1000);
      if (!this._vcur) this._vcur = [[], []];
      for (const i of [0]) {
        const pass = this._vcur[i];
        const pos = this._hvals[i];
        const last = pass[pass.length - 1];
        if (!last || last.pos !== pos) pass.push({ at, pos });
        else if (last.at > at) pass.push({ at, pos });
        this._vcurEnd = at;
      }
    }

    // Close the current pass (pause, seek or stop) so a later pass can replace it.
    _vrecBreak() {
      if (!this._vcur) return;
      this._vrecSample();
      this._vcur.forEach((pass, i) => {
        if (!pass.length) return;
        const end = Math.max(this._vcurEnd || 0, pass[pass.length - 1].at);
        if (end > pass[pass.length - 1].at) pass.push({ at: end, pos: pass[pass.length - 1].pos });
        this._vpasses[i].push(pass);
      });
      this._vcur = null;
    }

    _vrecHas() { return this._vpasses[0].some((p) => p.length) || this._vpasses[1].some((p) => p.length); }

    _vrecScript() {
      this._vrecBreak();
      const main = mergePasses(this._vpasses[0]);
      if (!main.length) return null;
      const end = main[main.length - 1].at;
      const stroke = this._strokeKindRec;       // the slider recorded position (stroke) or intensity
      if (!stroke && main[main.length - 1].pos !== 0) main.push({ at: end + 1, pos: 0 });
      const script = { version: '1.0', inverted: false, range: 100, actions: main,
        metadata: { creator: 'OggStudio', type: stroke ? 'stroke' : 'vibration', ...(this._vname ? { title: this._vname } : {}) } };
      const second = mergePasses(this._vpasses[1]);
      if (second.length) {
        if (second[second.length - 1].pos !== 0) second.push({ at: second[second.length - 1].at + 1, pos: 0 });
        script.channels = { V1: { actions: second } };
      }
      return script;
    }

    _vrecInfo() {
      const $ = this._el;
      const has = this._vrecHas() || Boolean(this._vcur && this._vcur[0].length);
      $('vrecdone').hidden = this._vrec || !has;
      const merged = has ? mergePasses([...this._vpasses[0], ...(this._vcur ? [this._vcur[0]] : [])]) : [];
      const passes = this._vpasses[0].filter((p) => p.length).length + (this._vcur && this._vcur[0].length ? 1 : 0);
      $('vrecinfo').textContent = has
        ? `${fmt(merged.length ? merged[merged.length - 1].at - merged[0].at : 0)} recorded${passes > 1 ? ` · ${passes} passes` : ''}`
        : (this._vrec ? 'Play the video to record' : '');
    }

    _vrecUse() {
      const script = this._vrecScript();
      if (!script) return;
      this._take = script;
      this._vraw = script;
      this._vscript = script;          // replay it with the video straight away
      this._vconvs = {};
      this._el('name').value = this._vname || '';
      this._vrecReset();
      this._toast(`Recorded ${fmt(duration(script))}. It is now the current take (save it below) and plays with this video.`);
      this._update();
    }

    _vrecDownload() {
      const script = this._vrecScript();
      if (script) this._download(script, this._vname || 'oggstudio');
    }

    _vrecReset() {
      this._vpasses = [[], []];
      this._vcur = null;
      this._videoStatus();
    }

    async _videoGo() {
      const $ = this._el;
      const video = $('video');
      if (!this._vurl) { this._toast('Choose a video first'); return; }
      if (!this._vscript && !this._vrec) { this._toast('Choose a script first, or press ● Rec to make one'); return; }
      try {
        if (video.ended) video.currentTime = 0;
        await video.play();          // the play event starts the sync
      } catch (e) { this._toast('The browser would not start the video: ' + (e.message || e)); }
    }

    _videoStatus(levels) {
      if (!this._el) return;
      const $ = this._el;
      const video = $('video');
      $('hb2').hidden = true;      // one slider: position or intensity, as chosen above
      const lab = this._strokeKindRec ? 'Position' : 'Intensity';
      const labEl = $('hb1').querySelector('.lab');
      if (labEl.textContent !== lab) labEl.textContent = lab;
      if (levels && !this._vrec && !this._hbActive && !this._outsHere && !(this._vsyncTimer && this._vscript)) this._showHBar(0, (levels[0] || 0) * 100);
      const parts = [];
      if (this._vscript) parts.push(`Script ${fmt(duration(this._vscript))}`);
      if (this._vurl && Number.isFinite(video.duration)) parts.push(`video ${fmt(video.duration * 1000)}`);
      if (this._vsyncTimer && levels) parts.push(`now ${levels.map((v) => Math.round(v * 100) + '%').join(' / ')}`);
      else if (this._vurl && this._vscript) parts.push('ready');
      $('vstat').textContent = parts.join(' · ');
      $('vgo').disabled = !(this._vurl && (this._vscript || this._vrec));
      this._vrecInfo();
    }

    get _noDevice() { return this._deviceId === NO_DEVICE; }
    get _device() { return this._noDevice ? null : this._devices.find((d) => d.id === this._deviceId) || this._devices[0] || null; }

    // Remember the chosen device per Home Assistant user (follows you across
    // phones), with a per-browser fallback when user data is unavailable.
    _rememberDevice(dev) {
      if (!dev) return;
      const value = { id: dev.id, name: dev.name };
      try { localStorage.setItem(DEVICE_KEY, JSON.stringify(value)); } catch (_) { /* private mode */ }
      this._remembered = value;
      this._hass?.callWS({ type: 'frontend/set_user_data', key: DEVICE_KEY, value }).catch(() => {});
    }

    async _loadRemembered() {
      try { this._remembered = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'); } catch (_) { this._remembered = null; }
      try {
        const res = await this._hass.callWS({ type: 'frontend/get_user_data', key: DEVICE_KEY });
        if (res && res.value && res.value.id) this._remembered = res.value;
      } catch (_) { /* older HA or no permission: keep the browser copy */ }
      this._rememberedLoaded = true;
      this._update();
    }

    _online(dev) {
      return Boolean(dev) && (!dev.connected || this._hass.states[dev.connected]?.state === 'on');
    }

    _pickDevice() {
      const list = this._devices;
      const known = (id) => list.find((d) => d.id === id);
      if (this._deviceId && (this._deviceId === NO_DEVICE || known(this._deviceId))) return this._deviceId;
      const saved = this._remembered;
      if (saved && saved.id === NO_DEVICE) return NO_DEVICE;
      const savedDev = saved && (known(saved.id) || list.find((d) => d.name === saved.name));
      if (savedDev) return savedDev.id;
      const wanted = this._config && this._config.device;
      const match = wanted && list.find((d) => d.stop === wanted || d.name === wanted);
      if (match) return match.id;
      const online = list.find((d) => this._online(d));
      if (online || list[0]) return (online || list[0]).id;
      return this._registryDone ? NO_DEVICE : undefined;   // none at all: record only
    }

    _update() {
      if (!this._el || !this._hass) return;
      const $ = this._el;
      this._fillVideoScripts();
      const sel = $('device');
      const key = JSON.stringify([this._rememberedLoaded, ...this._devices.map((d) => [d.id, d.name, this._online(d)])]);
      if (sel.dataset.key !== key) {
        // Connected devices first; ones Ogg can't reach are marked offline.
        const ordered = [...this._devices].sort((a, b) => Number(this._online(b)) - Number(this._online(a)) || a.name.localeCompare(b.name));
        sel.replaceChildren(...ordered.map((d) => new Option(this._online(d) ? d.name : `${d.name} (offline)`, d.id)),
          new Option('No device (record only)', NO_DEVICE));
        sel.dataset.key = key;
        // Wait for the remembered choice before falling back to a default.
        if (this._rememberedLoaded) this._deviceId = this._pickDevice();
      }
      if (this._deviceId) sel.value = this._deviceId;
      const dev = this._device;
      const online = dev && (!dev.connected || this._hass.states[dev.connected]?.state === 'on');
      $('takeplay').disabled = !this._take;
      // Someone else took over a device this card was driving: let it go quietly.
      for (const [stop, d] of this._claimed) {
        const c = this._claimedBy(d);
        if (c) { this._claimed.delete(stop); this._toast(`${c.label || 'Another controller'} took control of ${d.name}.`); }
      }
      this._outRender();
      $('rec').textContent = this._recording ? '■ Stop recording' : '● Record';
      $('rec').classList.toggle('on', this._recording);
      $('takebox').hidden = !this._take;
      if (this._take) {
        const kind = isStroke(this._take) ? 'stroke script' : `${this._take.channels ? 2 : 1} motor${this._take.channels ? 's' : ''}`;
        $('takeinfo').textContent = `${fmt(duration(this._take))} · ${kind} · ${this._take.actions.length} points · not saved`;
      }
      $('takemodebox').hidden = true;     // each device has its own follow type now
      const saved = this._studio && this._hass.states[this._studio.saved];
      const opts = (saved && saved.attributes.options) || [];
      const savedKey = JSON.stringify(opts);
      if ($('saved').dataset.key !== savedKey) { $('saved').replaceChildren(...opts.map((o) => new Option(o, o))); $('saved').dataset.key = savedKey; }
      if (saved && this.shadowRoot.activeElement !== $('saved')) $('saved').value = saved.state;
      const hasSaved = saved && saved.attributes.scripts && Object.keys(saved.attributes.scripts).length > 0;
      for (const id of ['code', 'delete']) $(id).disabled = !hasSaved;
      $('play').disabled = !hasSaved;
      // Stroke scripts: show the run mode, set to the one last used for it.
      const info = this._scriptInfo($('saved').value);
      $('libmodebox').hidden = true;
      const modeKey = `${$('saved').value}|${info && info.mode}`;
      if (info && info.kind === 'stroke' && $('libmode').dataset.key !== modeKey && this.shadowRoot.activeElement !== $('libmode')) {
        $('libmode').value = info.mode || RUN_MODE_DEFAULT;
        $('libmode').dataset.key = modeKey;
      }
      this._stShow();
      if (!$('speed').options.length) $('speed').replaceChildren(...SPEEDS.map((s) => new Option(s, s)));
      const speed = this._studio && this._hass.states[this._studio.speed];
      if (speed && this.shadowRoot.activeElement !== $('speed')) $('speed').value = speed.state;
    }

    _setPad(index, value) {
      const pad = this._el('pad' + (index + 1));
      const v = Math.round(Math.min(100, Math.max(0, value)));
      this._vals[index] = v;
      pad.querySelector('.fill').style.height = v + '%';
      pad.querySelector('.pct').textContent = v + '%';
      pad.setAttribute('aria-valuenow', String(v));
    }

    _bindPad(pad, index) {
      let active = false;
      const fromEvent = (event) => {
        const rect = pad.getBoundingClientRect();
        this._setPad(index, (1 - (event.clientY - rect.top) / rect.height) * 100);
      };
      this._padActive = this._padActive || [false, false];
      pad.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        active = true;
        this._padActive[index] = true;
        pad.classList.add('active');
        capture(pad, event);
        fromEvent(event);
      });
      pad.addEventListener('pointermove', (event) => { if (active) fromEvent(event); });
      const release = () => {
        if (!active) return;
        active = false;
        this._padActive[index] = false;
        pad.classList.remove('active');
        if (this._el('spring').checked && !(this._rp && this._rp.playing)) this._setPad(index, 0);
      };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) pad.addEventListener(type, release);
      pad.addEventListener('contextmenu', (event) => event.preventDefault());
      pad.addEventListener('keydown', (event) => {
        const steps = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 20, PageDown: -20 };
        if (event.key in steps) { this._setPad(index, this._vals[index] + steps[event.key]); event.preventDefault(); }
        else if (event.key === 'Home') { this._setPad(index, 0); event.preventDefault(); }
        else if (event.key === 'End') { this._setPad(index, 100); event.preventDefault(); }
      });
    }

    // Pads: one, or two when a second output is chosen (one track each).
    get _twoPads() { return Boolean(this._outs) && this._outTargetValue(1) !== 'off'; }

    _levels() {
      const levels = [this._vals[0] / 100];
      if (this._twoPads) levels.push(this._vals[1] / 100);
      return levels;
    }

    _setLive(on) {
      this._live = on;
      clearInterval(this._liveTimer);
      this._liveTimer = null;
      if (on || this._recording) {
        const send = () => this._padOut();
        send();
        this._liveTimer = setInterval(send, LIVE_MS);
      } else {
        this._outStop();
      }
    }

    // ---------------------------------------------------------- record / replay
    // Replay runs here in the browser: the script moves the pads or the
    // stroke bar, every device that follows gets it its own way, and it works
    // with no device at all. Touching the pads or bar overrides it until let go.
    _bindReplay() {
      const $ = this._el;
      this._rp = { raw: null, conv: null, name: '', lib: null, playing: false, t: 0, len: 0, last: 0, outAt: 0 };
      let ctl = null;
      try { ctl = localStorage.getItem(`oggstudio_ctl:${this.localName}`); } catch (_) { /* private mode */ }
      this._ctl = ctl === 'replay' ? 'replay' : 'record';
      for (const b of this.shadowRoot.querySelectorAll('.ctltabs button')) b.addEventListener('click', () => this._setCtl(b.dataset.ctl));
      $('rpspeed').replaceChildren(...SPEEDS.map((x) => new Option(x, x)));
      $('rpspeed').value = '1x';
      $('rppick').addEventListener('click', () => this._rpPicker(!$('rppop').hidden ? false : true));
      $('rpfile').addEventListener('change', () => this._rpFromFiles());
      $('rpplay').addEventListener('click', () => this._rpToggle());
      const bar = $('rpbar');
      const seek = (e) => { const r = bar.getBoundingClientRect(); this._rp.t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * this._rp.len; this._rpShow(); if (this._rp.playing) this._rpTick(); };
      bar.addEventListener('pointerdown', (e) => { if (!this._rp.raw) return; e.preventDefault(); capture(bar, e); seek(e); bar.dataset.drag = '1'; });
      bar.addEventListener('pointermove', (e) => { if (bar.dataset.drag) seek(e); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) bar.addEventListener(type, () => { delete bar.dataset.drag; });
      this.shadowRoot.addEventListener('pointerdown', (e) => {
        if ($('rppop').hidden) return;
        const path = e.composedPath();
        if (!path.includes($('rppop')) && !path.includes($('rppick'))) this._rpPicker(false);
      });
      this._ctlShow();
      this._rpShow();
    }

    _setCtl(mode) {
      if (mode === this._ctl) return;
      if (this._ctl === 'record') {
        if (this._recording) this._stopRecording();
        if (this._stRecording) this._stStop();
        if (this._live) { this._el('live').checked = false; this._setLive(false); }
        if (this._el('stlive').checked) { this._el('stlive').checked = false; this._stRun(); }
      } else {
        this._rpStop();
      }
      this._ctl = mode;
      try { localStorage.setItem(`oggstudio_ctl:${this.localName}`, mode); } catch (_) { /* private mode */ }
      this._ctlShow();
    }

    _ctlShow() {
      const $ = this._el;
      const replay = this._ctl === 'replay';
      for (const b of this.shadowRoot.querySelectorAll('.ctltabs button')) b.classList.toggle('on', b.dataset.ctl === this._ctl);
      $('rpbox').hidden = !replay;
      this._outRender();
      for (const id of ['rec', 'timer', 'strec', 'liverow', 'stliverow']) $(id).hidden = replay;
      this._rpShow();
    }

    _rpPicker(open) {
      const $ = this._el;
      if (!open) { $('rppop').hidden = true; return; }
      const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
      const names = ((saved && saved.attributes.options) || []).filter((n) => n && !/^\(.*\)$/.test(n));
      const item = (label, tag, fn) => { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `<span>${esc(label)}</span><small>${esc(tag)}</small>`; b.addEventListener('click', fn); return b; };
      const items = [];
      if (this._take) items.push(item('Current take', `${isStroke(this._take) ? 'stroke' : 'vibration'} · ${fmt(duration(this._take))}`, () => this._rpLoad(this._take, 'Current take', null)));
      for (const n of names) {
        const info = this._scriptInfo(n);
        items.push(item(n, info ? `${info.kind === 'stroke' ? 'stroke' : 'vibration'} · ${fmt(info.duration_ms || 0)}` : '', async () => {
          try { this._rpLoad(await this._getSaved(n), n, n); } catch (e) { this._toast('Could not load the script: ' + (e.message || e)); }
        }));
      }
      if (!items.length) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = 'No saved scripts yet: record one, or load a file below.'; items.push(d); }
      $('rplist').replaceChildren(...items);
      $('rppop').hidden = false;
    }

    async _rpFromFiles() {
      const files = [...this._el('rpfile').files];
      if (!files.length) return;
      try {
        const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
        const first = parsed[0];
        if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
        this._rpLoad(normalise(first, fileKind(files[0].name, 'auto'), Boolean(first.inverted)), fileTitle(files[0].name), null);
      } catch (e) { this._toast('Could not read the file: ' + (e.message || e)); }
      this._el('rpfile').value = '';
    }

    _rpLoad(script, name, lib) {
      this._rpStop();
      const rp = this._rp;
      rp.raw = script; rp.name = name; rp.lib = lib; rp.t = 0; rp.len = duration(script);
      const info = lib && this._scriptInfo(lib);
      rp.convs = {};
      this._useRemembered(lib, script);
      this._outRender();
      this._rpPicker(false);
      this._rpShow();
    }

    // The vibration version (pads in the vibrate view) of the loaded script.
    // Each output's value for a script at ms (vibrate view): a stroke script
    // is mapped per device by its follow type; a vibration script plays as
    // it is (its second track to the second output).
    // Each output's value for a script at ms: its track (the second output
    // takes a second track if there is one) mapped by that output's way of
    // following. Position (and a stroker) passes it straight through.
    _mapScript(raw, ms, cache) {
      return [0, 1].map((i) => {
        const v1 = i && raw.channels && raw.channels.V1 && raw.channels.V1.actions;
        const second = Boolean(v1 && v1.length);
        const track = second ? v1 : raw.actions;
        const p = parseTarget(this._outTargetValue(i));
        const m = this._outs[i].m;
        if (m === FOLLOW_STROKER || m === 'position' || (p && p.motor === 'l')) return sampleAt(track, ms);
        const key = `${second ? 1 : 0}:${m}`;
        if (!cache[key]) cache[key] = toIntensity(track, m);
        return sampleAt(cache[key], ms);
      });
    }

    // A live value (pad, slider) mapped by an output's way of following.
    _mapLive(i, value, vel) {
      const p = parseTarget(this._outTargetValue(i));
      const m = this._outs[i].m;
      if (p && p.motor === 'l') return { goal: value, dur: 150 };
      if (m === FOLLOW_STROKER || m === 'position') return value;
      return Math.min(100, Math.max(0, liveIntensity(m, value, vel)));
    }

    // Pads (vibrate recorder, live): each output follows its pad its own way.
    _padOut() {
      const now = performance.now();
      this._padVel = this._padVel || [0, 0];
      this._padPrev = this._padPrev || [null, null];
      const out = [0, 1].map((i) => {
        if (i && !this._twoPads) return null;
        const v = this._vals[i];
        const prev = this._padPrev[i];
        const dt = prev ? now - prev.at : 0;
        this._padVel[i] = this._padVel[i] * 0.6 + (dt > 0 ? (v - prev.v) / dt * 1000 : 0) * 0.4;
        this._padPrev[i] = { v, at: now };
        return this._mapLive(i, v, this._padVel[i]);
      });
      this._outApply(out, 1.0);
    }

    // A saved stroke script's remembered run mode becomes the first device's follow type.
    _useRemembered(lib, script) {
      const info = lib && this._scriptInfo(lib);
      const p = parseTarget(this._outTargetValue(0));
      if (info && info.mode && RUN_MODES[info.mode] && isStroke(script) && p && p.motor !== 'l') { this._outs[0].m = info.mode; this._outSave(); }
    }

    // The script converted with one run mode (cached per mode).
    _rpConv(mode) {
      const rp = this._rp;
      rp.convs = rp.convs || {};
      if (!rp.convs[mode]) rp.convs[mode] = runScript(rp.raw, mode);
      return rp.convs[mode];
    }

    _rpToggle() { if (this._rp.playing) this._rpStop(); else this._rpPlay(); }

    _rpPlay() {
      const rp = this._rp;
      if (!rp.raw) { this._rpPicker(true); return; }
      if (rp.t >= rp.len) rp.t = 0;
      const video = this._el('video');
      if (video && !video.paused) video.pause();     // one thing drives the devices at a time
      if (rp.lib && isStroke(rp.raw) && RUN_MODES[this._outs[0].m]) this._setMode(rp.lib, this._outs[0].m);
      rp.playing = true;
      this._outRender();
      rp.last = performance.now();
      rp.outAt = 0;
      clearInterval(this._rpTimer);
      this._rpTimer = setInterval(() => this._rpTick(), GP_POLL_MS);
      this._rpTick();
      this._rpShow();
    }

    _rpStop() {
      const rp = this._rp;
      if (!rp || !rp.playing) return;
      rp.playing = false;
      clearInterval(this._rpTimer);
      this._rpTimer = null;
      this._outStop();
      this._stOutAt = 0;
      if (this._st) this._stRun();     // lets the stroke timer stop if nothing else needs it
      this._outRender();
      this._rpShow();
    }

    _rpSpeed() { return parseFloat(this._el('rpspeed').value) || 1; }

    // Raw position (stroke view) at the replay time.
    _rpPos() { const rp = this._rp; return rp.raw ? sampleAt(rp.raw.actions, rp.t) : 0; }

    // A stroker's next move from the script: the next action and how long to get there.
    _rpGoal() {
      const rp = this._rp;
      const next = rp.raw && nextAction(rp.raw.actions, rp.t);
      return next ? { goal: next.pos, dur: (next.at - rp.t) / this._rpSpeed() } : null;
    }

    _rpTick() {
      const rp = this._rp;
      if (!rp.playing || !this._el) return;
      const now = performance.now();
      rp.t += Math.min(250, now - rp.last) * this._rpSpeed();
      rp.last = now;
      if (rp.t >= rp.len) {
        if (this._el('rploop').checked && rp.len > 0) rp.t = 0;
        else { rp.t = rp.len; this._rpStop(); this._toast(`Replay of "${rp.name}" finished.`); return; }
      }
      if (this._strokeKind) {
        this._stRun();                 // the stroke timer moves the bar and drives the devices
      } else if (rp.raw) {
        // Vibrate view: each device (and its pad) follows its own way; a
        // vibration script plays as it is (second track on pad 2).
        const targets = [0, 1].map((i) => parseTarget(this._outTargetValue(i)));
        const vals = this._mapScript(rp.raw, rp.t, rp.convs || (rp.convs = {}));
        for (const i of [0, 1]) if (!this._padActive || !this._padActive[i]) this._setPad(i, vals[i]);
        if (now - rp.outAt >= 100 || targets.some((t) => t && t.motor === 'l')) {
          if (now - rp.outAt >= 100) rp.outAt = now;
          const out = [0, 1].map((i) => {
            if (i && !this._twoPads) return null;
            if (targets[i] && targets[i].motor === 'l') return (this._padActive && this._padActive[i]) ? { goal: this._vals[i], dur: 150 } : (this._rpGoal() || { goal: this._vals[i], dur: 150 });
            return this._vals[i];
          });
          this._outApply(out, 0.6);
        }
      }
      if (now - (rp.shownAt || 0) >= 100) { rp.shownAt = now; this._rpShow(); }
    }

    _rpShow() {
      if (!this._el || !this._rp) return;
      const $ = this._el;
      const rp = this._rp;
      $('rpname').textContent = rp.raw ? rp.name : 'Choose a script…';
      $('rpfill').style.width = rp.len ? `${Math.min(100, rp.t / rp.len * 100)}%` : '0';
      const kind = rp.raw ? (isStroke(rp.raw) ? 'stroke script' : 'vibration script') : '';
      const parts = rp.raw ? [`${fmt(rp.t)} / ${fmt(rp.len)}`, kind] : ['Pick a saved script, the current take or a file'];
      if (rp.raw && !this._outs.some((o, i) => parseTarget(this._outTargetValue(i)))) parts.push('no device: showing only');
      if (rp.playing) parts.push(this._strokeKind ? 'touch the bar or a speed to take over' : 'touch a pad to take over');
      $('rpinfo').textContent = parts.join(' · ');
      $('rpplay').textContent = rp.playing ? '■ Stop' : '▶ Replay';
      $('rpplay').classList.toggle('stop', rp.playing);
    }

    // ---------------------------------------------------------- outputs
    _bindOutputs() {
      const $ = this._el;
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(OUT_KEY) || 'null'); } catch (_) { /* private mode */ }
      const t = saved && Array.isArray(saved.t) ? saved.t : [];
      const m = saved && Array.isArray(saved.m) ? saved.m : [];
      this._outs = [0, 1].map((i) => ({ t: typeof t[i] === 'string' ? t[i] : (i ? 'off' : null), m: typeof m[i] === 'string' ? m[i] : 'position' }));
      for (const row of this.shadowRoot.querySelectorAll('.outrow')) {
        const i = Number(row.dataset.row);
        row.querySelector('.outt').addEventListener('change', (e) => { this._outSwitch(i, { t: e.target.value }); });
        row.querySelector('.outm').addEventListener('change', (e) => { this._outSwitch(i, { m: e.target.value }); });
        row.querySelector('.outtake').addEventListener('click', () => this._outTake(i));
      }
      this._outRender();
    }

    _outSave() {
      try { localStorage.setItem(OUT_KEY, JSON.stringify({ t: this._outs.map((o) => o.t), m: this._outs.map((o) => o.m) })); } catch (_) { /* private mode */ }
    }

    _outSwitch(i, change) {
      // A device that stops being an output goes quiet (and is released).
      this._outStop();
      Object.assign(this._outs[i], change);
      this._outSave();
      this._outRender();
      this._update();
    }

    // The saved target if it still exists, else a sensible default.
    _outTargetValue(i) {
      const t = this._outs[i].t;
      if (t === 'none' || t === 'off') return t;
      const p = parseTarget(t);
      if (p && this._devices.some((d) => d.id === p.id)) return t;
      if (i === 1) return 'off';
      if (!this._registryDone) return 'none';
      const id = this._remembered && this._remembered.id;
      const dev = this._devices.find((d) => d.id === id) || this._devices.find((d) => this._online(d)) || this._devices[0];
      return dev ? `${dev.id}|${dev.linear && !dev.vibe ? 'l' : 'b'}` : 'none';
    }

    _outDevice(i) { const p = parseTarget(this._outTargetValue(i)); return p ? this._devices.find((d) => d.id === p.id) : null; }

    _controllers() {
      const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
      return (saved && saved.attributes.controllers) || {};
    }

    // Driven by another OggStudio card (another phone or browser) right now?
    _claimedBy(dev) {
      const c = dev && this._controllers()[dev.stop];
      if (!c || c.owner === this._owner) return null;
      if (this._tookAt && this._tookAt[dev.stop] && performance.now() - this._tookAt[dev.stop] < 3000) return null;   // we just took it
      return c;
    }

    _outLabel() {
      const ua = navigator.userAgent;
      const where = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'a browser';
      return `${(this._hass && this._hass.user && this._hass.user.name) || 'Someone'} on ${where}`;
    }

    _outClaim(dev) {
      if (this._claimedBy(dev)) return false;
      const now = performance.now();
      this._claimed.set(dev.stop, dev);
      if (!(now - (this._claimAt[dev.stop] || -1e9) < 4000)) {
        this._claimAt[dev.stop] = now;
        this._hass.callService('oggstudio', 'claim', { entity_id: dev.stop, owner: this._owner, label: this._outLabel() }, undefined, false).catch(() => {});
      }
      return true;
    }

    _outTake(i) {
      const dev = this._outDevice(i);
      if (!dev) return;
      this._tookAt = this._tookAt || {};
      this._tookAt[dev.stop] = performance.now();
      this._claimAt[dev.stop] = performance.now();
      this._hass.callService('oggstudio', 'claim', { entity_id: dev.stop, owner: this._owner, label: this._outLabel() }, undefined, false).catch(() => {});
      this._toast(`You now control ${dev.name}.`);
      this._outRender();
    }

    // Send output values (0-100; a stroker may get {goal, dur}) to the devices.
    _outApply(values, seconds) {
      if (!this._hass || !this._outs) return;
      const now = performance.now();
      const targets = this._outs.map((o, i) => this._outTargetValue(i));
      let blocked = false;
      for (const e of outLevels(targets, values, this._devices)) {
        if (!this._outClaim(e.dev)) { blocked = true; continue; }
        if (e.vibe) {
          const lv = e.levels.map((x) => Math.round(Math.min(100, Math.max(0, x))) / 100);
          const last = this._outLast[e.dev.id];
          if (!last || lv.some((x, j) => Math.abs(x - last.lv[j]) >= 0.01) || now - last.at > 500) {
            this._outLast[e.dev.id] = { lv, at: now };
            this._sendLive(e.dev, lv, seconds);
          }
        }
        if (e.linear !== null) this._outLinear(e.dev, typeof e.linear === 'object' ? e.linear : { goal: e.linear, dur: 150 }, now);
      }
      if (blocked !== Boolean(this._outBlocked)) { this._outBlocked = blocked; this._outRender(); }
    }

    // Strokers take "go to this position over this long" moves. Ogg's
    // ogg.linear does that live; without it, Ogg's Position control is used
    // (coarse: it moves over a fixed second).
    _outLinear(dev, move, now) {
      const goal = Math.round(Math.min(100, Math.max(0, move.goal)));
      const last = this._linLast[dev.id];
      if (last && last.goal === goal && now - last.at < 1000) return;
      const live = Boolean(this._hass.services && this._hass.services.ogg && this._hass.services.ogg.linear);
      if (last && now - last.at < (live ? 80 : 400)) return;
      this._linLast[dev.id] = { goal, at: now };
      if (live) this._hass.callService('ogg', 'linear', { entity_id: dev.stop, position: goal, duration: Math.max(50, Math.round(move.dur)) }, undefined, false).catch(() => {});
      else if (dev.linear) this._hass.callService('number', 'set_value', { entity_id: dev.linear, value: goal }, undefined, false).catch(() => {});
    }

    // Stop and release every device this card was driving (not ones another
    // controller has since taken over).
    _outStop() {
      for (const [stop, dev] of this._claimed) {
        if (this._claimedBy(dev)) continue;
        this._quietStop(dev);
        if (this._hass) this._hass.callService('oggstudio', 'claim', { entity_id: stop, owner: this._owner, release: true }, undefined, false).catch(() => {});
      }
      this._claimed.clear();
      this._claimAt = {};
      this._outLast = {};
      this._linLast = {};
    }

    _outRender() {
      if (!this._el || !this._outs) return;
      const stroke = this._strokeKind;
      const devs = [...this._devices].sort((a, b) => Number(this._online(b)) - Number(this._online(a)) || a.name.localeCompare(b.name));
      const opts = (i) => {
        const list = i ? [['off', stroke ? '— No second device —' : '— No second pad —'], ...(stroke ? [] : [['none', 'Second pad, no device']])] : [['none', 'No device (record only)']];
        for (const d of devs) {
          const name = this._online(d) ? d.name : `${d.name} (offline)`;
          const vibe = d.vibe || !d.linear;   // a stroker-only device has no vibration
          if (vibe && !d.dual) list.push([`${d.id}|b`, name]);
          if (vibe && d.dual) list.push([`${d.id}|b`, `${name} · both motors`], [`${d.id}|0`, `${name} · motor 1`], [`${d.id}|1`, `${name} · motor 2`]);
          if (d.linear) list.push([`${d.id}|l`, `${name} · stroker`]);
        }
        return list;
      };
      const labels = [];
      for (const row of this.shadowRoot.querySelectorAll('.outrow')) {
        const i = Number(row.dataset.row);
        const sel = row.querySelector('.outt');
        const list = opts(i);
        const key = JSON.stringify([stroke, list]);
        if (sel.dataset.key !== key) { sel.replaceChildren(...list.map(([v, t]) => new Option(t, v))); sel.dataset.key = key; }
        const value = this._outTargetValue(i);
        if ([...sel.options].some((o) => o.value === value)) sel.value = value;
        const p = parseTarget(value);
        const dev = p && this._devices.find((d) => d.id === p.id);
        labels.push(dev ? (p.motor === 'b' ? dev.name : p.motor === 'l' ? `${dev.name} (stroker)` : `${dev.name} m${Number(p.motor) + 1}`) : `Pad ${i + 1}`);
        // How it follows (stroke recorder): a stroker by position, a vibrator by a run mode.
        const msel = row.querySelector('.outm');
        const modes = p && p.motor === 'l' ? [[FOLLOW_STROKER, 'Stroker: follows the position']]
          : [...Object.entries(RUN_MODES).map(([v, t]) => [v, t.replace(/ \(vibration scripts\)/, '')]), [FOLLOW_STROKER, 'Stroker: level = position']];
        const mkey = JSON.stringify(modes);
        if (msel.dataset.key !== mkey) { msel.replaceChildren(...modes.map(([v, t]) => new Option(t, v))); msel.dataset.key = mkey; }
        if (!modes.some(([v]) => v === this._outs[i].m)) this._outs[i].m = modes[0][0];
        msel.value = this._outs[i].m;
        const owner = dev && this._claimedBy(dev);
        const take = row.querySelector('.outtake');
        take.hidden = !owner;
        if (owner) take.textContent = `Take control (${owner.label || 'in use'})`;
        // How it follows applies to everything played or recorded; not for "no second device".
        msel.hidden = value === 'off' || Boolean(owner);
        row.classList.toggle('solo', msel.hidden);
        row.classList.toggle('take', Boolean(owner));
      }
      this._padLabels = labels;
      for (const [i, id] of [[0, 'pad1'], [1, 'pad2']]) { const lab = this._el(id).querySelector('.lab'); if (lab.textContent !== labels[i]) lab.textContent = labels[i]; }
      const two = this._twoPads;
      this._el('pad2').hidden = !two;
      this._el('pads').classList.toggle('dual', two);
      const busy = this._devices.some((d) => this._claimedBy(d));
      const note = this._outBlocked ? 'A device is being controlled from another phone or browser: it does not follow here until you take control.'
        : busy ? 'Some devices are in use elsewhere.' : '';
      if (this._el('outnote').textContent !== note) this._el('outnote').textContent = note;
    }



    _startRecording() {
      const $ = this._el;
      this._recording = true;
      this._t0 = performance.now();
      this._samples = [[], []];
      this._last = [null, null];
      const sample = () => {
        const t = Math.round(performance.now() - this._t0);
        this._levels().forEach((v, i) => {
          const pos = Math.round(v * 100);
          if (pos !== this._last[i]) { this._samples[i].push({ at: t, pos }); this._last[i] = pos; }
        });
        $('timer').textContent = fmt(t);
      };
      sample();
      this._sampleTimer = setInterval(sample, SAMPLE_MS);
      this._setLive(true);
      this._update();
    }

    _stopRecording() {
      const $ = this._el;
      clearInterval(this._sampleTimer);
      const t = Math.round(performance.now() - this._t0);
      this._recording = false;
      this._setLive($('live').checked);
      for (const i of [0, 1]) if (this._samples[i].length) { this._samples[i].push({ at: t, pos: this._last[i] }); this._samples[i].push({ at: t + 1, pos: 0 }); }
      const take = { version: '1.0', inverted: false, range: 100, actions: this._samples[0], metadata: { creator: 'OggStudio', type: 'vibration' } };
      if (this._twoPads && this._samples[1].length) take.channels = { V1: { actions: this._samples[1] } };
      this._take = take.actions.length ? take : null;
      $('timer').textContent = '';
      this._setPad(0, 0); this._setPad(1, 0);
      this._update();
    }

    // Take and library playback run through Replay: the devices above,
    // each following its own way, and the pads or bar show it.
    _play(script) { this._playScript(script, 'Current take', null); }

    async _playSaved() {
      const name = this._el('saved').value;
      try { this._playScript(await this._getSaved(name), name, name); } catch (e) { this._toast('Could not load the script: ' + (e.message || e)); }
    }

    _playScript(script, name, lib) {
      if (!script) return;
      this._setCtl('replay');
      this._rpLoad(script, name, lib);
      if (SPEEDS.includes(this._el('speed').value)) this._el('rpspeed').value = this._el('speed').value;
      this._el('rploop').checked = this._el('loop').checked;
      this._rpPlay();
    }

    _stop() { this._rpStop(); }

    async _save() {
      const name = this._el('name').value.trim();
      if (!name) { this._toast('Type a name first'); return; }
      try {
        await this._hass.callService('oggstudio', 'save', { name, script: this._take, ...(isStroke(this._take) && RUN_MODES[this._outs[0].m] ? { mode: this._outs[0].m } : {}) });
        this._toast(`Saved "${name}"`);
        this._take = null;
        this._el('name').value = '';
        this._update();
      } catch (e) { this._toast(e.message || String(e)); }
    }

    // A saved script's details from the Saved script entity: kind
    // (stroke/vibration) and the run mode last used for it.
    _scriptInfo(name) {
      const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
      return (name && saved && saved.attributes.scripts && saved.attributes.scripts[name]) || null;
    }

    _setMode(name, mode) {
      this._hass.callService('oggstudio', 'set_mode', { name, mode }, undefined, false).catch(() => {});
    }

    _download(script, name) {
      if (!script) return;
      const blob = new Blob([JSON.stringify(script)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const base = String(name).replace(/[\\/:*?"<>|]+/g, '_').replace(/(\.vib)?(\.funscript)?$/i, '');
      a.download = `${base}${isStroke(script) ? '' : '.vib'}.funscript`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    async _getSaved(name) {
      const res = await this._hass.callWS({ type: 'call_service', domain: 'oggstudio', service: 'get_script', service_data: { name }, return_response: true });
      return res.response.script;
    }

    async _copySaved() {
      try { await this._copy(await this._getSaved(this._el('saved').value)); } catch (e) { this._toast(e.message || String(e)); }
    }

    async _copy(script) {
      if (!script) return;
      const code = await encodeCode(script);
      try { await navigator.clipboard.writeText(code); this._toast(`Code copied (${code.length} characters)`); }
      catch (e) {
        const out = this._el('codeout');
        out.hidden = false; out.value = code; out.select();
        this._toast('Clipboard unavailable: the code is shown in the Import box; copy it from there.');
      }
    }

    async _delete() {
      const name = this._el('saved').value;
      if (!name || !confirm(`Delete "${name}"?`)) return;
      try { await this._hass.callService('oggstudio', 'delete', { name }); this._toast(`Deleted "${name}"`); }
      catch (e) { this._toast(e.message || String(e)); }
    }

    async _import() {
      const $ = this._el;
      const mode = $('mode').value;
      const inverted = $('invert').checked;
      try {
        const files = [...$('files').files];
        let script;
        if (files.length) {
          const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
          const first = parsed[0];
          if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
          if (!first.metadata || !first.metadata.title) first.metadata = { ...(first.metadata || {}), title: fileTitle(files[0].name) };
          script = normalise(first, fileKind(files[0].name, mode), inverted);
        } else if ($('paste').value.trim()) {
          script = normalise(await decodeText($('paste').value), mode, inverted);
        } else { this._toast('Paste a script or choose a file first'); return; }
        this._take = script;
        $('name').value = (script.metadata && script.metadata.title) || '';
        $('paste').value = ''; $('files').value = '';
        if (isStroke(script)) $('takemode').value = RUN_MODE_DEFAULT;
        this._toast(`Loaded ${fmt(duration(script))} ${isStroke(script) ? 'stroke' : 'vibration'} script. Play it now or save it.`);
        this._update();
      } catch (e) { this._toast('Could not import: ' + (e.message || e)); }
    }

    _fillVideoScripts() {
      const sel = this._el('vsrc');
      const savedState = this._studio && this._studio.saved && this._hass.states[this._studio.saved];
      const names = ((savedState && savedState.attributes.options) || []).filter((n) => n && !/^\(.*\)$/.test(n));
      const take = this._take ? `Current take (${isStroke(this._take) ? 'stroke' : 'vibration'}, ${fmt(duration(this._take))})` : null;
      const key = JSON.stringify([names, take]);
      if (sel.dataset.key === key) return;
      const current = sel.value;
      sel.replaceChildren(new Option('From a file on this device…', ''), ...(take ? [new Option(take, TAKE_SRC)] : []), ...names.map((n) => new Option(`Library: ${n}`, n)));
      sel.dataset.key = key;
      if ([...sel.options].some((o) => o.value === current)) sel.value = current;
      else if (current === TAKE_SRC) { sel.value = ''; this._loadVideoScript(); }   // the take went (saved or discarded)
      this._el('vfilebox').hidden = sel.value !== '';
      // A new take while "Current take" is chosen: play the new one.
      if (sel.value === TAKE_SRC && this._vraw !== this._take) this._loadVideoScript();
    }

    // Streamed live levels: never call while the device is offline, never let
    // Home Assistant pop up an error per call (notifyOnError=false), and back
    // off after a failure so one problem gives one message.
    _sendLive(dev, levels, seconds) {
      if (!this._online(dev)) {
        this._toastOnce(`${dev.name} is not connected. Waiting for it to reconnect…`);
        return;
      }
      const now = performance.now();
      if (now < (this._liveBackoffUntil || 0)) return;
      if (this._liveProblem) { this._liveProblem = null; this._toast(''); }
      this._hass.callService('ogg', 'live', { entity_id: dev.stop, levels, seconds }, undefined, false)
        .catch((e) => {
          this._liveBackoffUntil = performance.now() + 3000;
          this._toastOnce(`Could not control ${dev.name}: ${e.message || e}. Retrying…`);
        });
    }

    _quietStop(dev) {
      if (!dev || !this._hass) return;
      this._hass.callService('ogg', 'stop_script', { entity_id: dev.stop }, undefined, false).catch(() => {});
    }

    _toastOnce(text) {
      if (this._liveProblem === text) return;
      this._liveProblem = text;
      this._toast(text);
    }

    _toast(text) { if (this._el) this._el('toast').textContent = text; }

    disconnectedCallback() {
      clearInterval(this._liveTimer); clearInterval(this._sampleTimer);
      this._stHalt();
      this._gpDetach();
      if (this._vsyncTimer) this._videoHalt();
      if (this._vurl) { URL.revokeObjectURL(this._vurl); this._vurl = null; }
      this._outStop();
    }
  }

  window.customCards = window.customCards || [];
  for (const [tag, variant] of Object.entries(VARIANTS)) {
    if (customElements.get(tag)) continue;
    const cls = tag === TAG ? OggStudioCard : class extends OggStudioCard { static get variant() { return variant; } };
    customElements.define(tag, cls);
    window.customCards.push({ type: tag, name: variant.name, description: variant.description, preview: true });
  }
})();
