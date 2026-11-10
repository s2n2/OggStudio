/* OggStudio card, built from frontend/src (npm run build). Do not edit here. */
(() => {
  // frontend/src/lib/core.js
  var TAG = "oggstudio-card";
  var VERSION = "0.14.0";
  var DEVICE_KEY = "oggstudio_device";
  var SPEEDS = ["0.5x", "0.75x", "1x", "1.25x", "1.5x", "2x"];
  var SAMPLE_MS = 100;
  var LIVE_MS = 100;
  var VIDEO_TICK_MS = 100;
  var CAST_PLATFORMS = ["cast", "dlna_dmr", "kodi", "apple_tv"];
  var CAST_DRIFT = 0.4;
  var CAST_GRACE = 3500;
  var VIDEO_OFFSET_KEY = "oggstudio_video_offset";
  var PARTS = ["record", "stroke", "take", "library", "video", "import"];
  var NO_DEVICE = "none";
  var TAKE_SRC = "take";
  var VARIANTS = {
    "oggstudio-card": {
      name: "OggStudio",
      sub: "Record, import, replay and sync to video",
      parts: PARTS.filter((p) => p !== "stroke"),
      size: 9,
      description: "Everything in one card: record, library, video sync and import."
    },
    "oggstudio-recorder-card": {
      name: "OggStudio Recorder",
      sub: "Draw a pattern with your finger and save it",
      parts: ["record", "take"],
      size: 6,
      description: "Big touch pads to record (or just play live), then save the take."
    },
    "oggstudio-player-card": {
      name: "OggStudio Player",
      sub: "Play saved patterns and import scripts",
      parts: ["library", "take", "import"],
      size: 5,
      description: "Pick a saved pattern and play it; paste or load funscripts and share codes."
    },
    "oggstudio-video-card": {
      name: "OggStudio Video",
      sub: "Play a local video with its script, or record one",
      parts: ["video", "take"],
      size: 7,
      description: "Sync a video on this device with a script, and record a funscript for it."
    },
    "oggstudio-stroke-card": {
      name: "OggStudio Stroke",
      sub: "Record stroke scripts (for a Handy) between two limits",
      parts: ["stroke", "take"],
      size: 8,
      description: "Stroke recorder: set an upper and lower limit, hold a speed to stroke between them, record a stroke funscript."
    }
  };
  var capture = (el, e) => {
    try {
      el.setPointerCapture(e.pointerId);
    } catch (_) {
    }
  };
  var esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var b64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(s);
  };
  var unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
  async function encodeCode(script) {
    const json = JSON.stringify(script);
    if (window.CompressionStream) {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
      return "ogg1:" + b64(await new Response(stream).arrayBuffer());
    }
    return "ogg0:" + b64(new TextEncoder().encode(json));
  }
  async function decodeText(text) {
    const value = text.trim();
    if (value.startsWith("ogg1:")) {
      if (!window.DecompressionStream) throw new Error("This browser cannot read compressed codes");
      const stream = new Blob([unb64(value.slice(5))]).stream().pipeThrough(new DecompressionStream("gzip"));
      return JSON.parse(await new Response(stream).text());
    }
    if (value.startsWith("ogg0:")) return JSON.parse(new TextDecoder().decode(unb64(value.slice(5))));
    return JSON.parse(value);
  }
  var duration = (s) => Math.max(
    s.actions.length ? s.actions[s.actions.length - 1].at : 0,
    s.channels && s.channels.V1.actions.length ? s.channels.V1.actions[s.channels.V1.actions.length - 1].at : 0
  );
  var fmt = (ms) => `${(ms / 1e3).toFixed(1)} s`;

  // frontend/src/lib/convert.js
  var RUN_MODES = {
    speed: "Speed: faster strokes vibrate harder",
    position: "Position: higher = stronger (vibration scripts)",
    upper: "Position above 50%: 50% and below = off, 75% = half power",
    combo: "Speed + position combined",
    down: "Speed, downstrokes only",
    up: "Speed, upstrokes only"
  };
  var RUN_MODE_DEFAULT = "speed";
  var runModeOptions = () => Object.entries(RUN_MODES).map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  var isStroke = (script) => Boolean(script && script.metadata && script.metadata.type === "stroke");
  var VIB_FILE = /\.vib\.(funscript|json)$/i;
  var fileKind = (name, kind) => kind === "auto" && VIB_FILE.test(name || "") ? "vibration" : kind;
  var fileTitle = (name) => String(name || "").replace(/(\.vib)?\.(funscript|json)$/i, "");
  var speedIntensity = (dpos, dtMs) => dtMs > 0 ? Math.min(100, Math.abs(dpos) / dtMs * 250) : 0;
  function moveIntensity(mode, from, to, dtMs) {
    const s = speedIntensity(to - from, dtMs);
    if (mode === "down") return to < from ? s : 0;
    if (mode === "up") return to > from ? s : 0;
    if (mode === "combo") return s + (100 - s) * 0.35 * ((from + to) / 2) / 100;
    return s;
  }
  var upperHalf = (pos) => Math.max(0, Math.round((pos - 50) * 2));
  var cleanActions = (actions) => (Array.isArray(actions) ? actions : []).filter((x) => x && Number.isFinite(x.at) && Number.isFinite(x.pos)).map((x) => ({ at: Math.max(0, Math.round(x.at)), pos: Math.round(Math.min(100, Math.max(0, x.pos))) })).sort((x, y) => x.at - y.at);
  function toIntensity(actions, mode) {
    const a = cleanActions(actions);
    if (mode === "upper") return a.map((x) => ({ at: x.at, pos: upperHalf(x.pos) }));
    if (!RUN_MODES[mode] || mode === "position" || a.length < 2) return a;
    const out = [];
    const push = (at, pos) => {
      const last = out[out.length - 1];
      if (last && last.at >= at) last.pos = pos;
      else out.push({ at, pos });
    };
    for (let i = 1; i < a.length; i++) {
      const v = Math.round(moveIntensity(mode, a[i - 1].pos, a[i].pos, a[i].at - a[i - 1].at));
      push(a[i - 1].at, v);
      if (a[i].at - a[i - 1].at > 1) push(a[i].at - 1, v);
    }
    push(a[a.length - 1].at, 0);
    return out;
  }
  function runScript(script, mode) {
    if (!isStroke(script)) return script;
    const out = { ...script, actions: toIntensity(script.actions, mode), metadata: { ...script.metadata, type: "vibration" } };
    if (script.channels && script.channels.V1) out.channels = { V1: { actions: toIntensity(script.channels.V1.actions, mode) } };
    return out;
  }
  function normalise(input, kind, inverted) {
    const type = kind === "auto" ? input.metadata && input.metadata.type === "vibration" ? "vibration" : "stroke" : kind;
    const flip = (acts) => inverted ? acts.map((x) => ({ at: x.at, pos: 100 - x.pos })) : acts;
    const script = { version: "1.0", inverted: false, range: 100, actions: flip(cleanActions(input.actions)) };
    const v1 = input.channels && (input.channels.V1 || input.channels.v1);
    if (v1 && Array.isArray(v1.actions)) script.channels = { V1: { actions: flip(cleanActions(v1.actions)) } };
    if (!script.actions.length) throw new Error("The script has no actions");
    script.metadata = { creator: "OggStudio", type, ...input.metadata && input.metadata.title ? { title: String(input.metadata.title) } : {} };
    return script;
  }
  function liveIntensity(mode, pos, vel) {
    if (mode === "position") return pos;
    if (mode === "upper") return upperHalf(pos);
    return moveIntensity(mode, pos - vel / 10, pos, 100);
  }

  // frontend/src/lib/gamepad.js
  var GP_SPEEDS = [15, 30, 60, 100, 180, 300];
  var GP_SPEED_DEFAULT = 3;
  var GP_ACTIONS = ["up", "down", "left", "right", "rec", "zero", "motor", "panic"];
  var GP_LABELS = { up: "Up (level up)", down: "Down (level down)", left: "Left (slower)", right: "Right (faster)", rec: "Record start/stop", zero: "Level to 0", motor: "Switch motor", panic: "Stop everything" };
  var GP_DEFAULT_MAP = {
    up: [{ b: 12 }, { a: 1, d: -1 }, { k: "ArrowUp" }],
    down: [{ b: 13 }, { a: 1, d: 1 }, { k: "ArrowDown" }],
    left: [{ b: 14 }, { a: 0, d: -1 }, { k: "ArrowLeft" }],
    right: [{ b: 15 }, { a: 0, d: 1 }, { k: "ArrowRight" }],
    rec: [{ b: 0 }, { k: "Enter" }, { k: "MediaPlayPause" }],
    zero: [{ b: 1 }, { k: "Escape" }, { k: "Backspace" }],
    motor: [{ b: 3 }],
    panic: [{ b: 8 }]
  };
  var GP_MAP_KEY = "oggstudio_pad_map";
  var GP_SPEED_KEY = "oggstudio_pad_speed";
  var GP_ON_KEY = "oggstudio_pad_on";
  var GP_DEAD = 0.25;
  var GP_POLL_MS = 20;
  var GP_HAT_TOL = 0.12;
  var GP_REST_SAMPLES = 40;
  var GP_HOLD_ACTIONS = ["up", "down", "left", "right", "zero", "motor", "panic"];
  function gpStrength(binds, pad, keys) {
    let best = 0;
    for (const bind of binds || []) {
      let v = 0;
      if (bind.k !== void 0) v = keys && keys.has(bind.k) ? 1 : 0;
      else if (!pad) continue;
      else if (bind.b !== void 0) {
        const btn = pad.buttons && pad.buttons[bind.b];
        v = btn && btn.pressed ? 1 : 0;
      } else if (bind.a !== void 0 && bind.v !== void 0) v = Math.abs(((pad.axes && pad.axes[bind.a]) ?? 99) - bind.v) < GP_HAT_TOL ? 1 : 0;
      else if (bind.a !== void 0) {
        const dead = bind.z || GP_DEAD;
        const raw = ((pad.axes && pad.axes[bind.a] || 0) - (bind.r || 0)) * bind.d;
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
  function gpStep(level, up, down, speed, dtMs) {
    return Math.min(100, Math.max(0, level + (up - down) * speed * Math.min(dtMs, 100) / 1e3));
  }
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
  var gpThreshold = (cal, i) => Math.max(0.35, 2 * (cal && cal.noise[i] || 0) + 0.2);
  var round2 = (v) => Math.round(v * 100) / 100;
  function gpPickInput(pad, cal, confirmButton) {
    if (!pad) return null;
    const b = gpFirstButton(pad, confirmButton, cal && cal.stuck);
    if (b >= 0) return { b };
    const axes = pad.axes || [];
    let best = -1, score = 1;
    for (let i = 0; i < axes.length; i++) {
      const s = Math.abs(axes[i] - (cal && cal.rest[i] || 0)) / gpThreshold(cal, i);
      if (s > score) {
        score = s;
        best = i;
      }
    }
    if (best < 0) return null;
    const v = axes[best], rest = cal && cal.rest[best] || 0;
    if (Math.abs(rest) > 1.05) return { a: best, v: round2(v) };
    const bind = { a: best, d: v > rest ? 1 : -1 };
    if (Math.abs(rest) > 0.05) bind.r = round2(rest);
    const dead = round2(Math.max(GP_DEAD, (cal && cal.noise[best] || 0) + 0.1));
    if (dead > GP_DEAD) bind.z = dead;
    return bind;
  }
  function gpFirstButton(pad, except, stuck) {
    const buttons = pad && pad.buttons || [];
    for (let i = 0; i < buttons.length; i++) {
      if (i !== except && buttons[i] && buttons[i].pressed && !(stuck && stuck.includes(i))) return i;
    }
    return -1;
  }
  var gpPressed = (pad) => [...pad && pad.buttons || []].map((b, i) => b && b.pressed ? i : -1).filter((i) => i >= 0);
  function gpChoosePad(pads, lastActive) {
    const live = pads.filter((p) => p && p.connected);
    return live.find((p) => p.index === lastActive) || live.find((p) => p.mapping === "standard") || live.sort((a, b) => (b.buttons || []).length - (a.buttons || []).length)[0] || null;
  }
  var gpRaw = (pad) => !pad ? "no gamepad" : `#${pad.index} "${String(pad.id).slice(0, 40)}" ${pad.mapping || "no-mapping"} · pressed [${gpPressed(pad).join(",")}] · axes ${[...pad.axes].map((v, i) => `${i}:${v.toFixed(2)}`).join(" ")}`;
  var gpDescribe = (b) => !b ? "default" : b.k !== void 0 ? `key ${b.k}` : b.b !== void 0 ? `button ${b.b}` : b.v !== void 0 ? `hat axis ${b.a} at ${b.v}` : `axis ${b.a} ${b.d > 0 ? "+" : "-"}`;
  function gpBuildMap(learned, defaultMap = GP_DEFAULT_MAP) {
    const key = (b) => JSON.stringify(b);
    const taken = new Set(Object.values(learned).flat().map(key));
    const map = {};
    for (const action of Object.keys(defaultMap)) {
      const own = learned[action] && learned[action].length ? learned[action] : [];
      const defaults = defaultMap[action].filter((b) => !taken.has(key(b)) && (own.length ? b.k !== void 0 : !(taken.size && b.a !== void 0)));
      map[action] = [...own, ...defaults];
    }
    return map;
  }
  function gpTargetFor(parts, hasVideo) {
    if (parts.includes("video") && hasVideo) return "video";
    if (parts.includes("stroke")) return "stroke";
    if (parts.includes("record")) return "record";
    return null;
  }
  var ST_ACTIONS = ["rec", "slow", "med", "fast", "limit", "reset", "panic"];
  var ST_LABELS = { rec: "Record start/stop", slow: "Slow stroke (hold)", med: "Medium stroke (hold)", fast: "Fast stroke (hold)", limit: "Set range limit", reset: "Reset range limits", panic: "Stop everything" };
  var ST_DEFAULT_MAP = {
    rec: [{ b: 0 }, { k: "Enter" }, { k: "MediaPlayPause" }],
    slow: [{ b: 14 }, { k: "ArrowLeft" }],
    med: [{ b: 13 }, { k: "ArrowDown" }],
    fast: [{ b: 15 }, { k: "ArrowRight" }],
    limit: [{ b: 12 }, { b: 2 }, { k: "ArrowUp" }, { k: "Space" }],
    reset: [{ b: 1 }, { k: "Escape" }, { k: "Backspace" }],
    panic: [{ b: 8 }]
  };
  var GP_PROFILES = {
    level: { actions: GP_ACTIONS, labels: GP_LABELS, defaults: GP_DEFAULT_MAP, hold: GP_HOLD_ACTIONS, mapKey: GP_MAP_KEY },
    stroke: { actions: ST_ACTIONS, labels: ST_LABELS, defaults: ST_DEFAULT_MAP, hold: ["slow", "med", "fast", "limit", "reset", "panic"], mapKey: "oggstudio_pad_map_stroke" }
  };
  var gpState = { owner: null };

  // frontend/src/lib/outputs.js
  var OUT_KEY = "oggstudio_outputs";
  var FOLLOW_STROKER = "stroker";
  var parseTarget = (t) => {
    const m = /^(.+)\|([01bl])$/.exec(t || "");
    return m ? { id: m[1], motor: m[2] } : null;
  };
  function outLevels(targets, values, devices) {
    const out = /* @__PURE__ */ new Map();
    targets.forEach((t, i) => {
      const p = parseTarget(t);
      const dev = p && devices.find((d) => d.id === p.id);
      const v = values[i];
      if (!dev || v === null || v === void 0) return;
      const e = out.get(dev.id) || { dev, levels: dev.dual ? [0, 0] : [0], vibe: false, linear: null };
      if (p.motor === "l") e.linear = v;
      else {
        e.vibe = true;
        if (p.motor === "b") e.levels = e.levels.map((x) => Math.max(x, v));
        else {
          const m = Math.min(Number(p.motor), e.levels.length - 1);
          e.levels[m] = Math.max(e.levels[m], v);
        }
      }
      out.set(dev.id, e);
    });
    return [...out.values()];
  }
  var STROKE_MIN_SPAN = 2;
  function railGrab(lim, v, tol) {
    const du = Math.abs(v - lim.upper), dl = Math.abs(v - lim.lower);
    if (Math.min(du, dl) <= tol) return du <= dl ? { mode: "upper" } : { mode: "lower" };
    if (v > lim.lower && v < lim.upper) return { mode: "move", off: v - lim.lower };
    return { mode: v > lim.upper ? "upper" : "lower" };
  }
  function railDrag(lim, grab, v) {
    const r = (x) => Math.round(Math.min(100, Math.max(0, x)));
    if (grab.mode === "upper") return { lower: lim.lower, upper: Math.max(lim.lower + STROKE_MIN_SPAN, r(v)) };
    if (grab.mode === "lower") return { lower: Math.min(lim.upper - STROKE_MIN_SPAN, r(v)), upper: lim.upper };
    const span = lim.upper - lim.lower;
    const lower = Math.min(100 - span, r(v - grab.off));
    return { lower, upper: lower + span };
  }
  function approachStep(pos, target, vel, dtMs) {
    const step = vel * Math.min(dtMs, 100);
    const d = target - pos;
    if (Math.abs(d) <= step) return { pos: target, caught: true };
    return { pos: pos + Math.sign(d) * step, caught: false };
  }
  function sampleAt(actions, ms) {
    if (!actions || !actions.length || ms < actions[0].at) return 0;
    let lo = 0, hi = actions.length - 1;
    if (ms >= actions[hi].at) return actions[hi].pos;
    while (hi - lo > 1) {
      const mid = lo + hi >> 1;
      if (actions[mid].at <= ms) lo = mid;
      else hi = mid;
    }
    const a = actions[lo], b = actions[hi];
    return b.at === a.at ? b.pos : a.pos + (b.pos - a.pos) * (ms - a.at) / (b.at - a.at);
  }
  function nextAction(actions, ms) {
    if (!actions || !actions.length || ms >= actions[actions.length - 1].at) return null;
    let lo = 0, hi = actions.length - 1;
    if (ms < actions[0].at) return actions[0];
    while (hi - lo > 1) {
      const mid = lo + hi >> 1;
      if (actions[mid].at <= ms) lo = mid;
      else hi = mid;
    }
    return actions[hi];
  }
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

  // frontend/src/lib/stroke.js
  var STROKE_TOP = 400;
  var STROKE_SPEEDS = [{ name: "Slow", pct: 30 }, { name: "Medium", pct: 55 }, { name: "Fast", pct: 100 }];
  var STROKE_PCT_MIN = 5;
  var okPct = (v) => Number.isInteger(v) && v >= STROKE_PCT_MIN && v <= 100;
  var STROKE_SPEED_KEY = "oggstudio_stroke_speeds";
  var strokeVel = (pct) => pct / 100 * STROKE_TOP / 1e3;
  var STROKE_LIMIT_KEY = "oggstudio_stroke_limits";
  function strokeStep(pos, dir, lower, upper, vel, dtMs) {
    const span = upper - lower;
    if (span < 1) return { pos, dir, turns: [] };
    if (pos < lower) dir = 1;
    else if (pos > upper) dir = -1;
    const total = vel * Math.min(dtMs, 100);
    let left = total;
    const turns = [];
    for (let guard = 0; guard < 64 && left > 1e-9; guard++) {
      const target = dir > 0 ? upper : lower;
      const dist = (target - pos) * dir;
      if (left < dist) {
        pos += left * dir;
        left = 0;
        break;
      }
      pos = target;
      left -= dist;
      dir = -dir;
      turns.push({ pos: target, frac: (total - left) / total });
    }
    return { pos, dir, turns };
  }
  function strokeSetLimit(lim, pos) {
    const p = Math.round(Math.min(100, Math.max(0, pos)));
    const keep = lim.last ? lim[lim.last] : Math.abs(p - lim.lower) <= Math.abs(p - lim.upper) ? lim.upper : lim.lower;
    if (Math.abs(p - keep) < 2) return null;
    return p > keep ? { lower: keep, upper: p, last: "upper" } : { lower: p, upper: keep, last: "lower" };
  }
  var STROKE_LIMITS_RESET = { lower: 0, upper: 100, last: null };

  // frontend/src/lib/ai.js
  var FOLLOW_AI = "ai";
  var AI_STEP = 50;
  var AI_HALF = 30;
  var AI_LIVE_MS = 3e3;
  var clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function aiRandom(seed) {
    let s = seed >>> 0;
    return () => {
      s = s + 1831565813 >>> 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var aiSeed = (acts) => acts.length * 7919 + (acts.length ? acts[acts.length - 1].at : 0) * 31 + (acts.length ? acts[0].pos : 0) >>> 0;
  var hashUnit = (n) => {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  function strokeFeatures(p) {
    const n = p.length;
    if (n < 3) return { speed: 0, rate: 0, amp: 0, center: n ? p[0] : 50, activity: 0, trend: 1 };
    let dist = 0, moving = 0, dir = 0, ext = p[0], extI = 0, prevExt = p[0];
    const halves = [];
    for (let i = 1; i < n; i++) {
      const d = p[i] - p[i - 1];
      dist += Math.abs(d);
      if (Math.abs(d) > 0.4) moving++;
      if (dir >= 0) {
        if (p[i] >= ext) {
          ext = p[i];
          extI = i;
        } else if (ext - p[i] > 4) {
          halves.push(Math.abs(ext - prevExt));
          prevExt = ext;
          dir = -1;
          ext = p[i];
          extI = i;
        }
      } else if (p[i] <= ext) {
        ext = p[i];
        extI = i;
      } else if (p[i] - ext > 4) {
        halves.push(Math.abs(ext - prevExt));
        prevExt = ext;
        dir = 1;
        ext = p[i];
        extI = i;
      }
    }
    const secs = (n - 1) * AI_STEP / 1e3;
    const real = halves.filter((a) => a >= 4);
    let lo = 100, hi = 0, sum = 0;
    for (const v of p) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      sum += v;
    }
    const amp = real.length ? real.reduce((a, b) => a + b, 0) / real.length : hi - lo;
    const third = Math.max(2, Math.floor(n / 3));
    const travel = (from, to) => {
      let t = 0;
      for (let i = from + 1; i < to; i++) t += Math.abs(p[i] - p[i - 1]);
      return t;
    };
    const early = travel(0, third), late = travel(n - third, n);
    return {
      speed: dist / secs,
      rate: real.length / 2 / secs,
      amp,
      center: sum / n,
      activity: moving / (n - 1),
      trend: early > 5 ? late / early : late > 20 ? 3 : 1
    };
  }
  function strokeMood(f, prev) {
    const hot = prev === true || ["intense", "frantic", "build", "edge"].includes(prev);
    if (f.speed < 12) return hot ? "edge" : "rest";
    if (hot && f.speed < 45 && f.activity < 0.5) return "edge";
    if (f.rate > 2 && f.amp < 35) return "frantic";
    if (f.speed > 230 && f.amp >= 30) return "intense";
    if (f.trend > 1.6 && f.speed > 40) return "build";
    if (f.speed >= 110) return "rhythm";
    if (f.amp >= 40 && f.activity > 0.6) return "glide";
    return "tease";
  }
  var sine01 = (x) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);
  var VIBE_PATTERNS = {
    breath: (t) => 6 + 6 * Math.sin(2 * Math.PI * 0.15 * t),
    off: () => 0,
    // Pulses here stay about 200 ms or longer, so Bluetooth toys do not miss them.
    heartbeat: (t, f, L) => {
      const per = 1 / clampN(f, 0.75, 1.2);
      const x = t % per / per;
      return (x < 0.24 ? 1 : x >= 0.5 && x < 0.74 ? 0.7 : 0) * (28 + 45 * L);
    },
    flicker: (t, f, L) => {
      const slot = Math.floor(t / 0.7);
      return hashUnit(slot) < 0.45 && t - slot * 0.7 < 0.25 ? 35 + 30 * L : 4;
    },
    slowwave: (t, f, L) => 10 + (25 + 30 * L) * sine01(0.3 * t),
    swell: (t, f, L, c) => 15 + (35 + 45 * L) * (1 - c.pos / 100),
    // deeper = stronger
    tide: (t, f, L) => 30 + 25 * L + 15 * Math.sin(2 * Math.PI * 0.2 * t),
    strokepulse: (t, f, L, c) => c.dir < 0 ? 45 + 45 * L : 12 + 10 * L,
    // a pulse on every downstroke
    steps: (t, f, L) => 28 + Math.floor(t * f / 2 % 1 * 4) * (10 + 8 * L),
    throb: (t, f, L) => 35 + (25 + 30 * L) * sine01(f * t),
    pound: (t, f, L) => t * f % 1 < Math.max(0.35, 0.2 * f) ? 100 : 55 + 20 * L,
    surge: (t, f) => 60 + 40 * (t * f % 1),
    high: (t, f, L) => 84 + 8 * L + 4 * Math.sin(2 * Math.PI * 3 * t),
    flutter: (t, f, L) => Math.sin(2 * Math.PI * 3 * t) > 0 ? 85 + 10 * L : 55,
    buzz: (t) => 86 + 8 * Math.sign(Math.sin(2 * Math.PI * 3 * t)),
    stutter: (t, f, L) => t * 2.5 % 1 < 0.5 ? 80 + 15 * L : 25,
    ramp: (t, f, L, c) => 30 + Math.min(60, Math.floor(c.tm / 1.5) * 10) + 8 * L,
    risingwave: (t, f, L, c) => 20 + (35 + 45 * Math.min(1, c.tm / 8)) * sine01(0.6 * t)
  };
  var STROKE_MOOD_PATTERNS = {
    rest: ["breath", "off"],
    edge: ["heartbeat", "off", "heartbeat"],
    tease: ["heartbeat", "flicker", "slowwave"],
    glide: ["swell", "tide", "slowwave"],
    rhythm: ["strokepulse", "steps", "throb"],
    build: ["ramp", "risingwave", "steps"],
    intense: ["pound", "surge", "high"],
    frantic: ["flutter", "buzz", "stutter"]
  };
  var MoodKeeper = class {
    constructor(seed, table) {
      this.r = aiRandom(seed);
      this.table = table;
      this.mood = null;
      this.cand = null;
      this.candAt = 0;
      this.pat = null;
      this.patAt = 0;
      this.patUntil = 0;
      this.moodAt = 0;
    }
    // Switch once a new mood has held most (70%) of the last `hold` seconds,
    // so one odd reading neither switches nor resets the wait.
    update(t, mood, hold) {
      if (this.mood === null) {
        this.mood = mood;
        this.moodAt = t;
        this.hist = [{ t, mood }];
        this.pick(t);
        return;
      }
      this.hist.push({ t, mood });
      while (this.hist.length > 1 && this.hist[0].t < t - hold) this.hist.shift();
      if (mood !== this.mood && t - this.hist[0].t >= hold * 0.8) {
        const share = this.hist.filter((h) => h.mood === mood).length / this.hist.length;
        if (share >= 0.7) {
          this.mood = mood;
          this.moodAt = t;
          this.pick(t);
        }
      }
      if (t >= this.patUntil) this.pick(t);
    }
    pick(t) {
      const list = this.table[this.mood];
      let p = list[Math.floor(this.r() * list.length)];
      if (p === this.pat && new Set(list).size > 1) p = list.find((x) => x !== this.pat);
      this.pat = p;
      this.patAt = t;
      this.patUntil = t + 10 + this.r() * 14;
    }
    get label() {
      return `${this.mood} · ${this.pat}`;
    }
  };
  var StrokeToVibe = class {
    constructor(seed) {
      this.k = new MoodKeeper(seed, STROKE_MOOD_PATTERNS);
    }
    step(t, f, ctx) {
      if (["intense", "frantic", "build"].includes(this.k.mood)) this.hotAt = t;
      const hot = this.hotAt !== void 0 && t - this.hotAt < 4;
      let mood = strokeMood(f, hot || this.k.mood);
      if (mood === "edge" && this.k.mood === "edge" && t - this.k.moodAt > 6) mood = "rest";
      this.k.update(t, mood, mood === "rest" || mood === "edge" ? 0.5 : 0.9);
      const L = this.k.mood === "edge" ? 0.12 : clampN(0.6 * f.speed / 320 + 0.4 * f.amp / 100, 0, 1);
      const tempo = clampN(f.rate || 1, 0.3, 4);
      return clampN(VIBE_PATTERNS[this.k.pat](t - this.k.patAt, tempo, L, { ...ctx, tm: t - this.k.moodAt }), 0, 100);
    }
  };
  function vibeFeatures(v) {
    const n = v.length;
    if (n < 3) return { mean: n ? v[0] : 0, std: 0, max: n ? v[0] : 0, pulseRate: 0, trend: 0 };
    let sum = 0, max = 0;
    for (const x of v) {
      sum += x;
      max = Math.max(max, x);
    }
    const mean = sum / n;
    let sq = 0;
    for (const x of v) sq += (x - mean) * (x - mean);
    const std = Math.sqrt(sq / n);
    const hyst = Math.max(6, std * 0.5);
    let side = 0, cross = 0;
    for (const x of v) {
      if (x > mean + hyst / 2 && side <= 0) {
        if (side < 0) cross++;
        side = 1;
      } else if (x < mean - hyst / 2 && side >= 0) {
        if (side > 0) cross++;
        side = -1;
      }
    }
    const secs = (n - 1) * AI_STEP / 1e3;
    const third = Math.max(1, Math.floor(n / 3));
    const avg = (from, to) => {
      let s = 0;
      for (let i = from; i < to; i++) s += v[i];
      return s / (to - from);
    };
    const a = avg(0, third), b = avg(third, n - third), c = avg(n - third, n);
    let lo = 0, hi = 0;
    for (let i = 1; i < n; i++) {
      if (v[i] < v[lo]) lo = i;
      if (v[i] >= v[hi]) hi = i;
    }
    const rising = b > a + 4 && c > b + 4 && lo <= n * 0.2 && hi >= n * 0.8;
    return { mean, std, max, pulseRate: cross / 2 / secs, trend: c - a, rising };
  }
  function vibeMood(f) {
    if (f.mean < 4 && f.max < 10) return "rest";
    if (f.pulseRate > 3.5 && f.mean > 35) return "buzz";
    if (f.trend > 15 && f.rising) return "build";
    if (f.mean > 68 && f.std < 15) return "strong";
    if (f.mean < 25) return "tease";
    if (f.std >= 14 && f.pulseRate >= 0.4) return f.mean < 35 ? "tease" : "pulse";
    if (f.std >= 10) return "wave";
    if (f.mean < 30) return "tease";
    return "steady";
  }
  var STROKE_STYLES = {
    park: () => ({ center: 85, amp: 0, period: 2 }),
    tiptease: (f) => ({ center: 82, amp: 14 + 12 * f.mean / 100, period: 2.2 - 0.8 * f.mean / 100, pauseEvery: 4, pauseLen: 0.8 }),
    slowfull: (f) => ({ center: 50, amp: 70, period: 3.2 - 1.2 * f.mean / 100 }),
    stopstart: () => ({ center: 70, amp: 30, period: 1.6, pauseEvery: 2, pauseLen: 1.2 }),
    swell: (f) => ({ center: 55, amp: 30 + 55 * f.mean / 100, period: 2.4 - 1.2 * f.mean / 100 }),
    tidal: (f) => ({ center: 60 - 20 * f.mean / 100, amp: 40 + 30 * f.mean / 100, period: 2 }),
    beat: (f) => ({ center: 55, amp: 35 + 45 * f.max / 100, period: clampN(1 / Math.max(f.pulseRate, 0.1), 0.45, 3) }),
    doublebeat: (f) => ({ center: 60, amp: 25 + 35 * f.max / 100, period: clampN(0.5 / Math.max(f.pulseRate, 0.1), 0.4, 2) }),
    metronome: (f) => ({ center: 55, amp: 45, period: 1.5 - 0.7 * f.mean / 100 }),
    longshort: (f, k) => ({ center: 50, amp: k % 4 < 2 ? 70 : 30, period: 1.2 - 0.5 * f.mean / 100 }),
    drift: (f, k, tm, t) => ({ center: 50 + 25 * Math.sin(0.15 * 2 * Math.PI * t), amp: 40, period: 1.3 - 0.5 * f.mean / 100 }),
    pound: (f) => ({ center: 40, amp: 80, period: 0.75 - 0.25 * f.mean / 100 }),
    fullfast: () => ({ center: 50, amp: 92, period: 0.6 }),
    mixed: (f, k) => k % 6 < 2 ? { center: 45, amp: 85, period: 1 } : { center: 60, amp: 30, period: 0.36 },
    vibrato: () => ({ center: 40, amp: 18, period: 0.3 }),
    shudder: (f, k) => k % 10 < 2 ? { center: 50, amp: 70, period: 0.7 } : { center: 30, amp: 12, period: 0.26 },
    climb: (f, k, tm) => ({ center: 55 - 10 * Math.min(1, tm / 10), amp: 30 + 60 * Math.min(1, tm / 10), period: 1.6 - 1 * Math.min(1, tm / 10) })
  };
  var VIBE_MOOD_STYLES = {
    rest: ["park"],
    tease: ["tiptease", "slowfull", "stopstart"],
    wave: ["swell", "tidal", "slowfull"],
    pulse: ["beat", "doublebeat", "beat"],
    steady: ["metronome", "longshort", "drift"],
    strong: ["pound", "fullfast", "mixed"],
    buzz: ["vibrato", "shudder"],
    build: ["climb", "climb", "swell"]
  };
  var VibeToStroke = class {
    constructor(seed) {
      this.k = new MoodKeeper(seed, VIBE_MOOD_STYLES);
      this.half = 0;
      this.pos = 85;
      this.dir = 1;
      this.nextAt = 0;
      this.paused = false;
    }
    // Next move {goal, dur ms} if one is due at t (s), else null (moving or pausing).
    plan(t, f) {
      this.k.update(t, vibeMood(f), 1);
      if (t < this.nextAt) return null;
      const P = STROKE_STYLES[this.k.pat](f, this.half, t - this.k.moodAt, t);
      if (P.amp < 2) {
        const goal2 = clampN(P.center, 0, 100);
        const dur2 = Math.max(800, Math.abs(goal2 - this.pos) / (STROKE_TOP / 1e3));
        this.pos = goal2;
        this.nextAt = t + dur2 / 1e3;
        return { goal: goal2, dur: dur2 };
      }
      if (P.pauseEvery && this.half > 0 && this.half % (P.pauseEvery * 2) === 0 && !this.paused) {
        this.paused = true;
        this.nextAt = t + P.pauseLen;
        return null;
      }
      this.paused = false;
      this.dir = -this.dir;
      const goal = clampN(P.center + this.dir * P.amp / 2, 0, 100);
      const dur = Math.max(P.period * 500, Math.abs(goal - this.pos) / (STROKE_TOP / 1e3));
      this.half += 1;
      this.pos = goal;
      this.nextAt = t + dur / 1e3;
      return { goal, dur };
    }
  };
  var resample = (actions, from, to) => {
    const out = [];
    for (let ms = from; ms <= to; ms += AI_STEP) out.push(sampleAt(actions, ms));
    return out;
  };
  function aiStrokeToVibe(actions) {
    const a = cleanActions(actions);
    if (a.length < 2) return { actions: a.map((x) => ({ at: x.at, pos: 0 })), moods: [] };
    const end = a[a.length - 1].at;
    const pos = resample(a, 0, end);
    const eng = new StrokeToVibe(aiSeed(a));
    const out = [], moods = [];
    let last = null;
    for (let k = 0; k < pos.length; k++) {
      const f = strokeFeatures(pos.slice(Math.max(0, k - AI_HALF), k + AI_HALF + 1));
      const dir = k + 1 < pos.length ? Math.sign(pos[k + 1] - pos[k]) : 0;
      const v = Math.round(eng.step(k * AI_STEP / 1e3, f, { pos: pos[k], dir }));
      if (!moods.length || moods[moods.length - 1].label !== eng.k.label) moods.push({ at: k * AI_STEP, label: eng.k.label });
      if (v !== last) {
        if (last !== null && out.length && out[out.length - 1].at < k * AI_STEP - AI_STEP) out.push({ at: k * AI_STEP - AI_STEP, pos: last });
        out.push({ at: k * AI_STEP, pos: v });
        last = v;
      }
    }
    out.push({ at: end, pos: last ?? 0 }, { at: end + 1, pos: 0 });
    return { actions: out, moods };
  }
  function aiVibeToStroke(actions) {
    const a = cleanActions(actions);
    if (!a.length) return { actions: [], moods: [] };
    const end = a[a.length - 1].at;
    const lv = resample(a, 0, end);
    const eng = new VibeToStroke(aiSeed(a));
    const out = [{ at: 0, pos: eng.pos }], moods = [];
    for (let k = 0; k < lv.length; k++) {
      const t = k * AI_STEP / 1e3;
      const f = vibeFeatures(lv.slice(Math.max(0, k - AI_HALF), k + AI_HALF + 1));
      const due = t >= eng.nextAt;
      const before = eng.pos;
      const move = eng.plan(t, f);
      if (!moods.length || moods[moods.length - 1].label !== eng.k.label) moods.push({ at: Math.round(t * 1e3), label: eng.k.label });
      if (move) out.push({ at: Math.round(t * 1e3 + move.dur), pos: Math.round(move.goal) });
      else if (due) out.push({ at: Math.round(eng.nextAt * 1e3), pos: Math.round(before) });
    }
    const clean = [];
    for (const x of out) {
      const l = clean[clean.length - 1];
      if (l && x.at <= l.at) l.pos = x.pos;
      else clean.push(x);
    }
    return { actions: clean, moods };
  }
  var moodAt = (moods, ms) => {
    let m = null;
    for (const x of moods) {
      if (x.at > ms) break;
      m = x.label;
    }
    return m;
  };
  var AiLive = class {
    constructor(kind) {
      this.kind = kind;
      this.buf = [];
      this.eng = kind === "stroke" ? new StrokeToVibe(Math.random() * 2 ** 32 >>> 0) : new VibeToStroke(Math.random() * 2 ** 32 >>> 0);
      this.last = null;
    }
    window(now) {
      const from = now - AI_LIVE_MS;
      while (this.buf.length > 2 && this.buf[1].at < from) this.buf.shift();
      const out = [];
      for (let ms = Math.max(from, this.buf[0].at); ms <= now; ms += AI_STEP) out.push(sampleAt(this.buf, ms));
      return out;
    }
    // Stroke in (position) -> vibration level.
    level(now, pos, dir) {
      this.buf.push({ at: now, pos });
      return this.eng.step(now / 1e3, strokeFeatures(this.window(now)), { pos, dir });
    }
    // Vibration in (level) -> next stroke move (or the last one while it runs).
    move(now, level) {
      this.buf.push({ at: now, pos: level });
      const m = this.eng.plan(now / 1e3, vibeFeatures(this.window(now)));
      if (m) this.last = m;
      return this.last || { goal: this.eng.pos, dur: 300 };
    }
    get label() {
      return this.eng.k.label;
    }
  };

  // frontend/src/lib/moods.js
  function moodTrack(start, stroke) {
    const a = [{ at: 0, pos: start }];
    let t = 0, v = start;
    const b = {
      get t() {
        return t;
      },
      get v() {
        return v;
      },
      to(p, ms) {
        p = clampN(Math.round(p), 0, 100);
        if (stroke) ms = Math.max(ms, Math.abs(p - v) / (STROKE_TOP / 1e3));
        t += Math.max(1, Math.round(ms));
        v = p;
        a.push({ at: t, pos: p });
        return b;
      },
      hold(ms) {
        t += Math.max(1, Math.round(ms));
        a.push({ at: t, pos: v });
        return b;
      },
      jump(p) {
        return b.to(p, 1);
      },
      until(end, fn) {
        let g = 0;
        while (t < end && g++ < 4e3) fn();
        return b;
      },
      done() {
        return a;
      }
    };
    return b;
  }
  var jit = (r, x, by = 0.1) => x * (1 - by + 2 * by * r());
  var BLE_PULSE = 250;
  var MS = {
    strokes: (lo, hi, half) => (b, end, r) => b.until(end, () => {
      const h = jit(r, half);
      b.to(hi, h).to(lo, h);
    }),
    breathe: (lo, hi, half) => (b, end, r) => b.until(end, () => {
      const h = jit(r, half);
      b.to(hi, h).hold(350).to(lo, h).hold(550);
    }),
    park: (pos) => (b, end) => {
      b.to(pos, 700);
      if (b.t < end) b.hold(end - b.t);
    },
    ramp: (from, to) => (b, end, r) => {
      const start = b.t;
      b.until(end, () => {
        const k = clampN((b.t - start) / Math.max(1, end - start), 0, 1);
        const L = (i) => from[i] + (to[i] - from[i]) * k;
        b.to(L(1), jit(r, L(2), 0.05)).to(L(0), jit(r, L(2), 0.05));
      });
    },
    stopstart: (lo, hi, half, n, pause) => (b, end, r) => b.until(end, () => {
      for (let i = 0; i < n; i++) b.to(hi, half).to(lo, half);
      b.hold(jit(r, pause, 0.3));
    }),
    flick: (base, amp, half, n, pause) => (b, end, r) => b.until(end, () => {
      b.to(base, 300);
      for (let i = 0; i < n; i++) b.to(base - jit(r, amp, 0.2), half).to(base, half);
      b.hold(jit(r, pause, 0.3));
    }),
    gasp: () => (b, end, r) => b.until(end, () => {
      b.to(92, 900).hold(jit(r, 1100, 0.3)).to(8, 250).hold(700).to(60, 1500).hold(500);
    }),
    clutch: (lo, hi) => (b, end, r) => b.until(end, () => {
      b.to(lo + (hi - lo) * r(), 200).hold(500 + 900 * r());
    }),
    reach: (top, bottom, up, down) => (b, end, r) => b.until(end, () => {
      b.to(top, jit(r, up)).hold(jit(r, 800, 0.3)).to(bottom, jit(r, down)).hold(300);
    }),
    steps: (ranges, each, half) => (b, end) => b.until(end, () => {
      for (const [lo, hi] of ranges) {
        if (b.t >= end) break;
        const stop = Math.min(end, b.t + each);
        while (b.t < stop) b.to(hi, half).to(lo, half);
      }
    }),
    edge: () => (b, end, r) => b.until(end, () => {
      for (let i = 0; i < 8; i++) {
        const h = 450 - i * 25;
        b.to(95, h).to(15, h);
      }
      b.to(90, 300).hold(1500 + 1500 * r());
    }),
    mix: () => (b, end, r) => b.until(end, () => {
      const big = r() < 0.35;
      const amp = big ? 85 : 25 + 20 * r();
      const h = big ? 500 : 180 + 120 * r();
      b.to(55 + amp / 2, h).to(55 - amp / 2, h);
    }),
    surprise: () => (b, end, r) => b.until(end, () => {
      const k = r();
      if (k < 0.25) b.hold(600 + 1200 * r());
      else if (k < 0.5) for (let i = 0; i < 3; i++) b.to(70, 150).to(45, 150);
      else if (k < 0.75) b.to(98, 1200).to(3, 1200);
      else b.to(100 * r(), 200).hold(700);
    })
  };
  var MV = {
    level: (x) => (b, end) => {
      b.to(x, 300);
      if (b.t < end) b.hold(end - b.t);
    },
    ramp: (lo, hi) => (b, end) => {
      b.to(lo, 200);
      b.to(hi, Math.max(200, end - b.t));
    },
    wave: (lo, hi, period, phase = 0) => (b, end, r) => {
      if (phase) b.to(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase)), 300);
      b.until(end, () => {
        const p = jit(r, period);
        for (let k = 1; k <= 8; k++) b.to(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * (k / 8 + phase))), p / 8);
      });
    },
    waveUp: (lo, hiFrom, hiTo, period) => (b, end, r) => {
      const start = b.t;
      b.until(end, () => {
        const p = jit(r, period);
        const hi = hiFrom + (hiTo - hiFrom) * clampN((b.t - start) / Math.max(1, end - start), 0, 1);
        for (let k = 1; k <= 8; k++) b.to(lo + (hi - lo) * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / 8)), p / 8);
      });
    },
    // Pulses stay at least BLE_PULSE long, on and off: updates go out about
    // every 100 ms and Bluetooth adds delay, so shorter taps can be missed.
    pulses: (lvl, on, off, offFirst = false) => (b, end, r) => {
      on = Math.max(BLE_PULSE, on);
      off = Math.max(BLE_PULSE, off);
      if (offFirst) b.jump(0).hold(off);
      b.until(end, () => {
        b.jump(lvl).hold(on).jump(0).hold(Math.max(BLE_PULSE, jit(r, off, 0.15)));
      });
    },
    heartbeat: (lvl, bpm, delay = 0) => (b, end) => {
      const per = 6e4 / bpm, on1 = Math.max(220, per * 0.24), gap = Math.max(220, per * 0.2), on2 = Math.max(220, per * 0.22);
      const dub = per >= on1 + gap + on2 + BLE_PULSE;
      if (delay) b.jump(0).hold(delay);
      b.until(end, () => {
        b.jump(lvl).hold(on1).jump(0);
        if (dub) b.hold(gap).jump(lvl * 0.7).hold(on2).jump(0).hold(per - on1 - gap - on2);
        else b.hold(Math.max(BLE_PULSE, per - on1));
      });
    },
    buzz: (lvl) => (b, end, r) => b.until(end, () => {
      b.jump(Math.min(100, lvl + 6 + 4 * r())).hold(170).jump(lvl - 12).hold(170);
    }),
    // a ~3 Hz texture
    flicker: (lvl, base) => (b, end, r) => b.until(end, () => {
      b.jump(base).hold(300 + 500 * r());
      b.jump(lvl * (0.7 + 0.3 * r())).hold(BLE_PULSE + 80 * r());
    }),
    steps: (levels, each) => (b, end) => b.until(end, () => {
      for (const x of levels) {
        if (b.t >= end) break;
        b.jump(x).hold(Math.min(each, Math.max(1, end - b.t)));
      }
    }),
    bursts: (lvl, burst, gap, base = 0) => (b, end, r) => b.until(end, () => {
      b.to(lvl, 80).hold(jit(r, burst, 0.2)).to(base, 200).hold(jit(r, gap, 0.3));
    }),
    swell: (lo, hi, rise, fall, top) => (b, end) => b.until(end, () => {
      b.to(hi, rise).hold(top).to(lo, fall).hold(300);
    }),
    gasp: () => (b, end, r) => b.until(end, () => {
      b.to(25, 900).hold(jit(r, 1100, 0.3)).jump(95).hold(250).to(10, 700).hold(700).to(40, 1500).hold(500);
    }),
    clutch: (lo, hi) => (b, end, r) => b.until(end, () => {
      b.jump(lo + (hi - lo) * r()).hold(500 + 900 * r());
    }),
    random: (lo, hi) => (b, end, r) => b.until(end, () => {
      b.to(lo + (hi - lo) * r(), 150 + 500 * r()).hold(200 + 800 * r());
    }),
    edge: () => (b, end, r) => b.until(end, () => {
      b.to(70 + 20 * r(), 3600).jump(0).hold(1500 + 1500 * r());
    }),
    surprise: () => (b, end, r) => b.until(end, () => {
      const k = r();
      if (k < 0.25) b.jump(0).hold(600 + 1200 * r());
      else if (k < 0.5) for (let i = 0; i < 3; i++) b.jump(90).hold(BLE_PULSE).jump(0).hold(BLE_PULSE);
      else if (k < 0.75) b.to(80, 1200).to(10, 1200);
      else b.jump(30 + 70 * r()).hold(700);
    })
  };
  var MOODS = {
    rest: { icon: "🌙", label: "Rest", combos: [
      ["Still breath", [[3e4, MS.park(85), MV.wave(0, 12, 6e3)]]],
      ["Slow drift", [[3e4, MS.breathe(70, 90, 2500), MV.wave(4, 15, 8e3)]]],
      ["Quiet", [[2e4, MS.park(90), MV.level(0)], [1e4, MS.breathe(75, 90, 3e3), MV.heartbeat(10, 50)]]]
    ] },
    soft: { icon: "☁️", label: "Soft", combos: [
      ["Feather", [[3e4, MS.strokes(60, 90, 1300), MV.wave(8, 30, 5e3)]]],
      ["Cloud", [[3e4, MS.breathe(40, 80, 1800), MV.swell(10, 35, 2500, 2500, 800)]]],
      ["Gentle steps", [[3e4, MS.strokes(55, 85, 1e3), MV.steps([10, 18, 26, 18], 1500)]]]
    ] },
    tease: { icon: "😏", label: "Tease", combos: [
      ["Heartbeat tease", [[12e3, MS.flick(88, 12, 250, 4, 1500), MV.heartbeat(35, 62)], [6e3, MS.strokes(20, 90, 1500), MV.wave(10, 40, 4e3)], [12e3, MS.flick(85, 15, 220, 3, 2e3), MV.heartbeat(40, 70)]]],
      ["Stop-start", [[3e4, MS.stopstart(30, 85, 500, 4, 2200), MV.bursts(55, 2e3, 2200)]]],
      ["Almost", [[9e3, MS.ramp([65, 85, 700], [35, 95, 350]), MV.ramp(10, 70)], [3e3, MS.park(90), MV.level(0)], [9e3, MS.ramp([60, 85, 700], [30, 95, 320]), MV.ramp(15, 75)], [3e3, MS.park(92), MV.level(0)]]]
    ] },
    wave: { icon: "🌊", label: "Wave", combos: [
      ["Ocean", [[3e4, MS.strokes(10, 90, 1500), MV.wave(15, 75, 6e3)]]],
      ["Rolling", [[3e4, MS.breathe(20, 85, 1100), MV.swell(20, 70, 2200, 2200, 400)]]],
      ["Tide", [[15e3, MS.strokes(40, 80, 1200), MV.wave(20, 55, 5e3)], [15e3, MS.strokes(10, 95, 1400), MV.wave(30, 85, 5e3)]]]
    ] },
    gasp: { icon: "😮", label: "Gasp", combos: [
      ["Catch breath", [[3e4, MS.gasp(), MV.gasp()]]],
      ["Sudden", [[8e3, MS.strokes(60, 85, 600), MV.level(20)], [1500, MS.strokes(5, 95, 250), MV.level(95)], [4e3, MS.park(90), MV.level(5)], [8e3, MS.strokes(55, 85, 650), MV.level(25)], [1500, MS.strokes(5, 95, 250), MV.level(100)], [4e3, MS.park(90), MV.level(5)]]],
      ["Hold it", [[5e3, MS.strokes(70, 95, 300), MV.wave(30, 60, 1500)], [2500, MS.park(95), MV.level(0)], [1200, MS.strokes(5, 95, 280), MV.level(100)], [3e3, MS.park(60), MV.level(15)], [5e3, MS.strokes(70, 95, 300), MV.wave(30, 60, 1500)], [2500, MS.park(95), MV.level(0)], [1200, MS.strokes(5, 95, 280), MV.level(100)], [3e3, MS.park(60), MV.level(15)]]]
    ] },
    build: { icon: "📈", label: "Build", combos: [
      ["Climb", [[3e4, MS.ramp([65, 85, 900], [5, 95, 280]), MV.ramp(10, 95)]]],
      ["Stairs", [[3e4, MS.ramp([60, 85, 800], [10, 95, 320]), MV.steps([15, 30, 45, 60, 75, 90], 5e3)]]],
      ["Wave up", [[3e4, MS.ramp([50, 80, 1200], [5, 95, 350]), MV.waveUp(10, 40, 100, 2500)]]]
    ] },
    buzz: { icon: "🐝", label: "Buzz", combos: [
      ["Hum", [[3e4, MS.strokes(40, 60, 150), MV.buzz(75)]]],
      ["Hive", [[3e4, MS.strokes(30, 50, 130), MV.flicker(95, 60)]]],
      ["Static", [[3e4, MS.strokes(35, 55, 120), MV.random(55, 95)]]]
    ] },
    edge: { icon: "🎯", label: "Edge", combos: [
      ["Brink", [[3e4, MS.edge(), MV.edge()]]],
      ["Hold back", [[3e4, MS.stopstart(10, 95, 280, 6, 3500), MV.bursts(90, 2400, 3500)]]],
      ["Slow burn", [[22e3, MS.ramp([50, 85, 900], [10, 95, 300]), MV.ramp(20, 90)], [6e3, MS.park(92), MV.heartbeat(15, 50)]]]
    ] },
    frantic: { icon: "⚡", label: "Frantic", combos: [
      ["Rush", [[3e4, MS.strokes(25, 75, 110), MV.buzz(90)]]],
      ["Scramble", [[3e4, MS.mix(), MV.random(60, 100)]]],
      ["Flurry", [[3e4, MS.stopstart(30, 70, 100, 10, 400), MV.pulses(100, 900, 250)]]]
    ] },
    steady: { icon: "🎵", label: "Steady", combos: [
      ["Metronome", [[3e4, MS.strokes(20, 80, 600), MV.level(55)]]],
      ["Groove", [[3e4, MS.strokes(25, 85, 500), MV.pulses(65, 500, 500)]]],
      ["Cruise", [[3e4, MS.strokes(15, 85, 700), MV.wave(45, 65, 3e3)]]]
    ] },
    step: { icon: "🪜", label: "Step", combos: [
      ["Staircase", [[3e4, MS.steps([[70, 90], [55, 90], [40, 90], [25, 90], [10, 90]], 6e3, 600), MV.steps([20, 35, 50, 65, 80], 6e3)]]],
      ["Up and down", [[3e4, MS.steps([[70, 90], [50, 90], [30, 90], [10, 90], [30, 90], [50, 90]], 2500, 450), MV.steps([20, 40, 60, 80, 60, 40], 2500)]]],
      ["Terraces", [[3e4, MS.steps([[60, 90], [60, 90], [30, 90], [30, 90], [5, 95], [5, 95], [80, 92]], 2e3, 500), MV.steps([30, 30, 60, 60, 90, 90, 0], 2e3)]]]
    ] },
    bold: { icon: "🔥", label: "Bold", combos: [
      ["Pound", [[3e4, MS.strokes(5, 70, 300), MV.bursts(100, 250, 250, 60)]]],
      ["Full force", [[3e4, MS.strokes(5, 95, 330), MV.level(95)]]],
      ["Thunder", [[3e4, MS.breathe(5, 95, 350), MV.swell(70, 100, 400, 400, 300)]]]
    ] },
    embrace: { icon: "🤗", label: "Embrace", combos: [
      ["Hug", [[3e4, MS.breathe(10, 60, 1600), MV.wave(35, 70, 5e3), MV.wave(35, 70, 5e3, 0.5)]]],
      ["Hold close", [[3e4, MS.breathe(5, 30, 1200), MV.level(60), MV.swell(30, 75, 2e3, 2e3, 1e3)]]],
      ["Wrap", [[3e4, MS.strokes(5, 55, 1400), MV.swell(40, 80, 1800, 1800, 1500), MV.wave(40, 80, 5400, 0.5)]]]
    ] },
    tip: { icon: "👆", label: "Tip", combos: [
      ["Flicks", [[3e4, MS.flick(92, 12, 160, 6, 900), MV.flicker(70, 10)]]],
      ["Circling", [[3e4, MS.strokes(78, 98, 400), MV.wave(20, 55, 2e3)]]],
      ["Taps", [[3e4, MS.flick(95, 20, 200, 2, 1100), MV.pulses(60, 200, 1100)]]]
    ] },
    long: { icon: "↕️", label: "Long", combos: [
      ["Full length", [[3e4, MS.strokes(2, 98, 1300), MV.wave(25, 75, 2600)]]],
      ["Slow and deep", [[3e4, MS.breathe(2, 98, 1800), MV.swell(20, 80, 1800, 1800, 600)]]],
      ["Long pulls", [[3e4, MS.strokes(5, 95, 900), MV.pulses(70, 900, 900)]]]
    ] },
    surprise: { icon: "🎲", label: "Surprise", combos: [
      ["Wildcard", [[3e4, MS.surprise(), MV.surprise()]]],
      ["Jumble", [[8e3, MS.mix(), MV.random(30, 100)], [4e3, MS.park(90), MV.level(0)], [8e3, MS.strokes(5, 95, 300), MV.pulses(100, 300, 200)], [6e3, MS.flick(88, 15, 200, 3, 900), MV.heartbeat(40, 70)]]],
      ["Plot twist", [[1e4, MS.strokes(60, 90, 1200), MV.wave(10, 30, 4e3)], [2500, MS.strokes(5, 95, 250), MV.level(100)], [8e3, MS.breathe(40, 80, 1500), MV.heartbeat(30, 60)], [2500, MS.strokes(20, 80, 110), MV.buzz(90)]]]
    ] },
    grasp: { icon: "✊", label: "Grasp", combos: [
      ["Clutch", [[3e4, MS.clutch(10, 90), MV.clutch(30, 95)]]],
      ["Grip and release", [[3e4, MS.stopstart(5, 40, 400, 3, 1500), MV.bursts(85, 1500, 1500, 10)]]],
      ["Reach", [[3e4, MS.reach(95, 10, 600, 1400), MV.swell(20, 90, 600, 1400, 900)]]]
    ] },
    squeeze: { icon: "🫳", label: "Squeeze", combos: [
      ["Tight", [[3e4, MS.strokes(2, 25, 500), MV.bursts(85, 800, 400, 50)]]],
      ["Pulse squeeze", [[3e4, MS.strokes(5, 30, 300), MV.pulses(80, 300, 300), MV.pulses(80, 300, 300, true)]]],
      ["Hold squeeze", [[3e4, MS.breathe(2, 30, 700), MV.swell(40, 90, 700, 700, 900)]]]
    ] },
    heartbeat: { icon: "💓", label: "Heartbeat", combos: [
      ["Calm heart", [[3e4, MS.breathe(60, 80, 500), MV.heartbeat(45, 60)]]],
      ["Racing heart", [[3e4, MS.strokes(40, 70, 250), MV.heartbeat(70, 110)]]],
      ["Heart to heart", [[3e4, MS.strokes(30, 80, 500), MV.heartbeat(55, 75), MV.heartbeat(55, 75, 400)]]]
    ] },
    ripple: { icon: "〰️", label: "Ripple", combos: [
      ["Ripples", [[3e4, MS.strokes(50, 80, 250), MV.wave(30, 60, 800)]]],
      ["Shimmer", [[3e4, MS.strokes(40, 70, 180), MV.buzz(50)]]],
      ["Rings", [[3e4, MS.breathe(30, 80, 600), MV.swell(10, 60, 300, 900, 200)]]]
    ] },
    deep: { icon: "⬇️", label: "Deep", combos: [
      ["Depths", [[3e4, MS.strokes(2, 45, 900), MV.level(65)]]],
      ["Grind", [[3e4, MS.strokes(2, 20, 600), MV.wave(55, 85, 2400)]]],
      ["Plunge", [[3e4, MS.reach(80, 2, 900, 400), MV.bursts(90, 800, 900, 30)]]]
    ] },
    peak: { icon: "🌋", label: "Peak", combos: [
      ["Summit", [[2e4, MS.ramp([40, 85, 600], [2, 98, 260]), MV.ramp(40, 100)], [1e4, MS.strokes(2, 98, 260), MV.level(100)]]],
      ["Crescendo", [[3e4, MS.ramp([30, 80, 500], [2, 98, 250]), MV.steps([50, 60, 70, 80, 90, 100], 5e3)]]],
      ["Release", [[18e3, MS.strokes(5, 95, 280), MV.bursts(100, 700, 150, 80)], [8e3, MS.breathe(50, 90, 1500), MV.wave(10, 40, 4e3)], [4e3, MS.park(85), MV.heartbeat(20, 55)]]]
    ] },
    afterglow: { icon: "🌅", label: "Afterglow", combos: [
      ["Glow", [[3e4, MS.breathe(60, 90, 2500), MV.wave(5, 25, 7e3)]]],
      ["Linger", [[3e4, MS.strokes(50, 85, 2e3), MV.heartbeat(18, 50)]]],
      ["Warm", [[3e4, MS.park(80), MV.swell(5, 20, 3e3, 4e3, 2e3)]]]
    ] },
    playful: { icon: "🎈", label: "Playful", combos: [
      ["Tickle", [[3e4, MS.flick(85, 20, 150, 3, 600), MV.flicker(70, 0)]]],
      ["Bounce", [[3e4, MS.mix(), MV.pulses(60, 200, 300)]]],
      ["Peekaboo", [[3e4, MS.stopstart(40, 90, 300, 2, 900), MV.bursts(70, 600, 900)]]]
    ] }
  };
  var MOOD_TIP = 95;
  var MOOD_BASE = 5;
  var MOOD_EASE = 1500;
  function moodAnchor(ms) {
    let start = 0, i = 0, prev = MOOD_TIP;
    for (; ; ) {
      const len = 1e4 + 6e3 * hashUnit(i + 7);
      const here = i % 2 ? MOOD_BASE : MOOD_TIP;
      if (ms < start + len) {
        const k = i === 0 ? 1 : Math.min(1, (ms - start) / MOOD_EASE);
        return prev + (here - prev) * (0.5 - 0.5 * Math.cos(Math.PI * k));
      }
      start += len;
      prev = here;
      i++;
    }
  }
  var moodSoften = (pos, k, ms = 0) => {
    const a = moodAnchor(ms);
    return a + (pos - a) * k;
  };
  function buildMood(sections, r) {
    const s = moodTrack(85, true), v1 = moodTrack(0, false), v2 = moodTrack(0, false);
    let end = 0, two = false;
    for (const [ms, sf, vf, vf2] of sections) {
      end += Math.round(jit(r, ms));
      sf(s, end, r);
      vf(v1, end, r);
      if (vf2) {
        two = true;
        vf2(v2, end, r);
      }
      const m = Math.max(s.t, v1.t, v2.t, end);
      for (const b of [s, v1, v2]) if (b.t < m) b.hold(m - b.t);
      end = m;
    }
    v1.to(0, 300);
    v2.to(0, 300);
    s.hold(300);
    return { stroke: s.done(), vibe: two ? [v1.done(), v2.done()] : [v1.done()] };
  }

  // frontend/src/card/styles.js
  var STYLES = `
:host{--ink:#e8edff;--muted:#8f9ab8;--line:rgba(174,194,246,.16)}
ha-card{background:#0a1122;color:var(--ink);border-radius:22px;border:1px solid #293552;padding:16px;font-family:inherit;display:flex;flex-direction:column}
.toast{order:99}
h2{margin:0 0 2px;font-size:20px;letter-spacing:-.02em} .sub{color:var(--muted);font-size:12px;margin-bottom:12px}
section{border:1px solid var(--line);border-radius:16px;padding:12px;margin-top:10px;background:rgba(255,255,255,.035)}
h3{margin:0 0 8px;font-size:13px;color:#cdd6f6;letter-spacing:.01em}
label{display:block;font-size:11px;color:var(--muted);margin:6px 0 3px}
select,input[type=text],input[type=password],textarea{width:100%;box-sizing:border-box;background:#18233d;color:var(--ink);border:1px solid #33415f;border-radius:10px;padding:8px;font:inherit;font-size:13px}
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
.ctltabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
.ctltabs button{flex:1 1 auto;padding:0 12px;white-space:nowrap}
.ctltabs button.live:not(.on){box-shadow:inset 0 0 0 2px #67e0c8}
.head{display:flex;align-items:center;gap:8px;margin-bottom:2px}
.head h2{flex:1;margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.head button{flex:0 0 auto;min-height:36px;padding:0 12px;font-size:13px}
ha-card.locked > :not(#cover){display:none!important}
.cover{display:flex;flex-direction:column;gap:10px;padding:8px 0}
.cover[hidden]{display:none}
.cover .stop{align-self:flex-start;min-height:36px;padding:0 12px;font-size:13px}
.subbox{margin-top:8px;padding:10px;border-radius:14px;border:1px solid #293552;background:#0e1730}
.subbox .row{margin-top:6px}
.subbox .row:first-child{margin-top:0}
.limbtn{margin-top:8px;min-height:36px;font-size:13px;width:100%}
.limdev h4{margin:8px 0 0;font-size:13px;color:#bef2ff}
.limdev:first-child h4{margin-top:0}
.limdev label b{color:#bef2ff}
.limdev input{width:100%}
.rpbar canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:none;image-rendering:pixelated}
.rpbar.heat canvas{display:block}
.rpbar.heat i{background:rgba(255,255,255,.3);border-right:2px solid #fff}
.rppop button{flex-wrap:wrap}
.pkheat{flex:0 0 100%;width:100%;height:5px;border-radius:3px;margin:2px 0 4px;image-rendering:pixelated}
.plitem{display:flex;gap:6px;margin-bottom:6px}
.plitem button{flex:0 0 40px;min-height:40px;padding:0}
.plitem .plname{flex:1;text-align:left;padding:0 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#18233d}
.plitem.on .plname{box-shadow:inset 0 0 0 2px #67e0c8}
#plbtn.on{box-shadow:inset 0 0 0 2px #67e0c8}
#auel{width:100%;margin-top:6px}
#tgsend,#tgshare,#tglink{width:100%}
.moodgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px}
.moodgrid button.moodbtn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:60px;padding:4px;font-size:12px;background:#18233d}
.moodgrid button.moodbtn span{font-size:20px;line-height:1}
.moodgrid button.moodbtn.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710;border-color:transparent}
.moodrow{display:flex;align-items:center;gap:8px;margin-top:6px}
.moodrow label{margin:0;flex:0 0 auto}
.moodrow input{flex:1}
.moodrow b{flex:0 0 44px;text-align:right;font-size:12.5px;color:#bef2ff}
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
.outai{grid-column:1/-1;font-size:11.5px;color:#ffcf8a;font-weight:700;margin:-2px 2px 0}
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
`;

  // frontend/src/card/card.js
  var OggStudioCard = class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._devices = [];
      this._remembered = null;
      this._rememberedLoaded = false;
      this._take = null;
      this._recording = false;
      this._live = false;
      this._samples = null;
      this._vscript = null;
      this._vurl = null;
      this._gpKeys = /* @__PURE__ */ new Set();
      this._gpPrev = {};
      this._gpFloat = [null, null];
      this._gpMotor = 0;
      this._owner = window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
      this._claimed = /* @__PURE__ */ new Map();
      this._claimAt = {};
      this._outLast = {};
      this._linLast = {};
      this.shadowRoot.addEventListener("pointerdown", () => {
        gpState.owner = this;
      }, true);
    }
    static get variant() {
      return VARIANTS[TAG];
    }
    get _variant() {
      return this.constructor.variant;
    }
    get _baseParts() {
      const wanted = this._config && Array.isArray(this._config.sections) ? this._config.sections.filter((p) => PARTS.includes(p)) : [];
      return wanted.length ? wanted : this._variant.parts;
    }
    // A card with one recorder (pads or stroke) can switch between the two
    // with the Vibrate / Stroke toggle; the choice is kept per card type.
    get _canToggleKind() {
      const b = this._baseParts;
      return b.includes("record") !== b.includes("stroke");
    }
    get _kindKey() {
      return `oggstudio_rec_kind:${this.localName}`;
    }
    get _recKind() {
      if (this._kind) return this._kind;
      let saved = null;
      try {
        saved = localStorage.getItem(this._kindKey);
      } catch (_) {
      }
      this._kind = saved === "stroke" || saved === "vibrate" ? saved : this._baseParts.includes("stroke") ? "stroke" : "vibrate";
      return this._kind;
    }
    get _parts() {
      const base = this._baseParts;
      if (!this._canToggleKind) return base;
      const [from, to] = this._recKind === "stroke" ? ["record", "stroke"] : ["stroke", "record"];
      return base.map((x) => x === from ? to : x);
    }
    _setRecKind(kind) {
      if (kind === this._recKind) return;
      if (this._recording) this._stopRecording();
      if (this._live) {
        this._el("live").checked = false;
        this._setLive(false);
      }
      if (this._stRecording) this._stStop();
      if (this._st) {
        this._st.touch = null;
        this._st.pad = null;
        this._st.drag = null;
        this._st.latch = null;
      }
      this._el("stlive").checked = false;
      this._stHalt();
      this._kind = kind;
      try {
        localStorage.setItem(this._kindKey, kind);
      } catch (_) {
      }
      this._applyParts();
      if (this._rp && this._rp.playing) this._rpTick();
      this._gpStatus();
    }
    _applyParts() {
      const parts = this._parts;
      for (const sec of this.shadowRoot.querySelectorAll("[data-part]")) {
        sec.classList.toggle("off", !parts.includes(sec.dataset.part));
        sec.style.order = String(parts.indexOf(sec.dataset.part) + 1);
      }
      for (const tog of this.shadowRoot.querySelectorAll(".kind")) {
        tog.hidden = !this._canToggleKind;
        for (const b of tog.querySelectorAll("button")) b.classList.toggle("on", b.dataset.kind === this._recKind);
      }
      const rec = parts.includes("stroke") ? "stroke" : parts.includes("record") ? "record" : null;
      const slot = rec && this.shadowRoot.querySelector(`[data-part="${rec}"] .outslot`);
      const box = this._el("outbox");
      this._el("outhome").appendChild(box);
      const cslot = rec && this.shadowRoot.querySelector(`[data-part="${rec}"] .ctlslot`);
      (cslot || this._el("outhome")).insertBefore(this._el("ctlbox"), cslot ? null : box);
      const gslot = this.shadowRoot.querySelector(`[data-part="${rec || "video"}"]:not(.off) .gpslot`);
      if (gslot) gslot.appendChild(this._el("gp"));
      this._el("outhome").classList.remove("off");
      this._el("outhome").style.order = "0";
      this._el("ctlbox").hidden = !rec;
      if (this._rp) this._ctlShow();
      this._el("devbox").hidden = true;
      if (this._outs) this._outRender();
    }
    get _strokeKind() {
      return this._parts.includes("stroke");
    }
    setConfig(config) {
      this._config = config || {};
      this._render();
    }
    getCardSize() {
      return this._variant.size;
    }
    static getStubConfig() {
      return {};
    }
    set hass(hass) {
      this._hass = hass;
      if (!this._registryLoaded) {
        this._registryLoaded = true;
        this._loadRegistry();
      }
      this._update();
      if (this._cast) this._castSync();
    }
    async _loadRegistry() {
      if (!this._rememberedLoaded && !this._loadingRemembered) {
        this._loadingRemembered = true;
        this._loadRemembered();
      }
      try {
        const [entities, devices] = await Promise.all([
          this._hass.callWS({ type: "config/entity_registry/list" }),
          this._hass.callWS({ type: "config/device_registry/list" })
        ]);
        const names = new Map(devices.map((d) => [d.id, d.name_by_user || d.name || "Device"]));
        const byDevice = /* @__PURE__ */ new Map();
        this._studio = {};
        for (const e of entities) {
          if (e.disabled_by) continue;
          const uid = String(e.unique_id || "");
          if (e.entity_id.startsWith("media_player.")) {
            (this._mpPlatform = this._mpPlatform || {})[e.entity_id] = e.platform;
            continue;
          }
          if (e.platform === "oggstudio") {
            if (uid.endsWith(":saved_script")) this._studio.saved = e.entity_id;
            if (uid.endsWith(":speed")) this._studio.speed = e.entity_id;
            continue;
          }
          if (e.platform !== "ogg" || !e.device_id || uid.split(":").length < 3) continue;
          const d = byDevice.get(e.device_id) || { id: e.device_id, name: names.get(e.device_id) };
          if (uid.endsWith(":stop")) d.stop = e.entity_id;
          if (uid.endsWith(":connected")) d.connected = e.entity_id;
          if (uid.endsWith(":motor_level_1")) d.dual = true;
          if (uid.endsWith(":linear_0")) d.linear = e.entity_id;
          if (uid.endsWith(":intensity") || uid.endsWith(":motor_level_0")) d.vibe = true;
          byDevice.set(e.device_id, d);
        }
        this._devices = [...byDevice.values()].filter((d) => d.stop).sort((a, b) => a.name.localeCompare(b.name));
        this._registryDone = true;
      } catch (err) {
        this._toast("Could not read the device list: " + (err.message || err));
      }
      this._update();
    }
    _render() {
      this.shadowRoot.innerHTML = `
      <style>
${STYLES}
      </style>
      <ha-card>
        <div class="cover" id="cover" hidden>
          <h2 id="covername">Studio</h2>
          <div id="coverpin"><label>PIN</label><div class="row"><input id="pin" type="password" inputmode="numeric" autocomplete="off" aria-label="PIN"><button id="pingo" type="button" style="flex:0 0 auto">Open</button></div></div>
          <button id="coveropen" type="button" class="go">Open</button>
          <div class="hint" id="covermsg"></div>
          <button id="coverstop" type="button" class="stop">■ Stop all</button>
        </div>
        <div class="head"><h2 id="title">${esc(this._config.title || this._variant.name)}</h2><button id="lockbtn" type="button" title="Lock this card" aria-label="Lock this card" hidden>🔒</button><button id="stopall" type="button" class="stop" title="Stop every device now">■ Stop all</button></div>
        <div class="sub" id="sub">${esc(this._variant.sub)} · v${VERSION}</div>
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
            <div class="ctltabs" role="tablist"><button type="button" data-ctl="record">● Record</button><button type="button" data-ctl="replay">▶ Replay</button><button type="button" data-ctl="mood">◎ Mood</button><button type="button" data-ctl="audio">♪ Audio</button><button type="button" data-ctl="together">🤝 Together</button></div>
            <div id="moodbox" hidden>
              <div class="moodgrid">${Object.entries(MOODS).map(([k, m]) => `<button type="button" class="moodbtn" data-mood="${k}"><span>${m.icon}</span>${m.label}</button>`).join("")}</div>
              <div class="rpbar" id="moodbar"><i id="moodfill"></i></div>
              <div class="rpinfo" id="moodinfo"></div>
              <div class="moodrow"><label title="Vibration level, and stroke depth and speed">Strength</label><input id="moodstr" type="range" min="20" max="100" step="5" value="100"><b id="moodstrv">100%</b></div>
              <div class="row" style="margin-top:6px"><button id="moodnext" type="button">🎲 Another</button><button id="moodstop" type="button" class="stop">■ Stop</button></div>
            </div>
            <div class="rpbox" id="rpbox" hidden>
              <button id="rppick" type="button" class="rppick">📂 <span id="rpname">Choose a script…</span></button>
              <div class="rppop" id="rppop" hidden><div id="rplist"></div><label class="rpfile">From a file on this device: <input id="rpfile" type="file" accept=".funscript,.json,application/json" multiple></label></div>
              <div class="rpbar" id="rpbar" title="Tap to jump. Colour shows how intense each part is"><canvas id="rpheat" width="240" height="1"></canvas><i id="rpfill"></i></div>
              <div class="rpinfo" id="rpinfo"></div>
              <div class="rprow"><button id="rpplay" type="button" class="go">▶ Replay</button><select id="rpspeed" aria-label="Replay speed"></select><label class="check"><input id="rploop" type="checkbox"> Loop</label></div>
              <div class="row" style="margin-top:8px"><button id="tlbtn" type="button">✂ Tools</button><button id="plbtn" type="button">☰ Queue</button></div>
              <div class="subbox" id="tlbox" hidden>
                <div class="row"><button id="tlstart" type="button">Cut before here</button><button id="tlend" type="button">Cut after here</button></div>
                <div class="row"><select id="tln" aria-label="How many times"></select><button id="tlloop" type="button">Repeat</button></div>
                <div class="row"><select id="tlother" aria-label="Script to add"></select><button id="tlstitch" type="button">Add after</button></div>
                <div class="hint">Drag the bar to a spot, then cut. Each change becomes the current take; the saved script is not touched.</div>
              </div>
              <div class="subbox" id="plbox" hidden>
                <div id="pllist"></div>
                <div class="row"><select id="pladd" aria-label="Add to the queue"></select><button id="pladdbtn" type="button" style="flex:0 0 auto">Add</button></div>
                <div class="row"><button id="plplay" type="button">▶ Play queue</button><label class="check"><input id="plloop" type="checkbox"> Repeat queue</label></div>
                <div class="row"><select id="plsaved" aria-label="Saved queues"></select><button id="pldel" type="button" style="flex:0 0 auto">Delete</button></div>
                <div class="row"><input id="plname" type="text" placeholder="Queue name"><button id="plsave" type="button" style="flex:0 0 auto">Save queue</button></div>
              </div>
            </div>
            <div id="aubox" hidden>
              <label>Sound from</label><select id="ausrc"><option value="mic">Microphone</option><option value="file">A music file on this device</option><option value="video">The video in Video sync</option><option value="tab">Another tab (share its audio)</option></select>
              <div id="aufilebox" hidden><input id="aufile" type="file" accept="audio/*,video/*" style="margin-top:6px"><audio id="auel" controls preload="metadata"></audio></div>
              <label>Feel</label><select id="aumode"></select>
              <div class="moodrow"><label title="How easily it reacts">Sensitivity</label><input id="ausens" type="range" min="0" max="100" step="5" value="50"><b id="ausensv">50%</b></div>
              <div class="meter"><i id="aum1"></i></div><div class="meter m2"><i id="aum2"></i></div>
              <div class="rpinfo" id="auinfo"></div>
              <button id="augo" type="button" class="go" style="margin-top:6px">♪ Start</button>
            </div>
            <div id="tgbox" hidden>
              <div id="tgidle">
                <div class="hint" style="margin-top:0">Play together from two places. Each of you gets a slider that drives the other's devices, by feel, inside the limits each has set. Either of you can stop both sides at any time.</div>
                <button id="tgstart" type="button" class="go" style="margin-top:8px">🤝 Start a session</button>
                <label>Or join one: paste the link you were sent</label>
                <div class="row"><input id="tglink" type="text" placeholder="https://…/api/oggstudio/together/…" autocomplete="off"><button id="tgjoin" type="button" style="flex:0 0 auto">Join</button></div>
              </div>
              <div id="tglive" hidden>
                <div id="tgsharebox"><label>Send this link to your partner</label><div class="row"><input id="tgshare" type="text" readonly><button id="tgcopy" type="button" style="flex:0 0 auto">Copy</button></div></div>
                <div class="rpinfo" id="tgstat"></div>
                <label class="check"><input id="tgaccept" type="checkbox"> Let my partner control my devices</label>
                <label>From my partner</label><div class="meter"><i id="tgin"></i></div>
                <label>To my partner <b id="tgsendv">0%</b></label><input id="tgsend" type="range" min="0" max="100" step="1" value="0">
                <div class="row" style="margin-top:8px"><button id="tgstop" type="button" class="stop">■ Stop both</button><button id="tgend" type="button">End session</button></div>
              </div>
            </div>
          </div>
          <div class="outbox" id="outbox">
            <label>Devices, and how each follows (used for recording, replay, library and video)</label>
            <div class="outrow" data-row="0"><select class="outt" aria-label="First device"></select><select class="outm" aria-label="How the first device follows"></select><div class="outai" hidden></div><button class="outtake" type="button" hidden>Take control</button></div>
            <div class="outrow" data-row="1"><select class="outt" aria-label="Second device"></select><select class="outm" aria-label="How the second device follows"></select><div class="outai" hidden></div><button class="outtake" type="button" hidden>Take control</button></div>
            <div class="outnote" id="outnote"></div>
            <button id="limbtn" type="button" class="limbtn">⚙ Limits</button>
            <div class="subbox" id="limbox" hidden><div id="limlist"></div><div class="hint">Nothing goes past these, whatever is driving: pads, scripts, moods, audio or a partner. They are kept in Home Assistant for every card.</div></div>
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
          <div class="hint" style="margin-top:0">The video plays from this phone or computer. 📺 Cast streams it to a TV through Home Assistant while you watch; nothing is saved there. Keep this screen on while casting.</div>
          <label>Video</label><input id="vfile" type="file" accept="video/*">
          <label>Script</label><select id="vsrc"></select>
          <div id="vfilebox"><input id="vscriptfile" type="file" accept=".funscript,.json,application/json" multiple style="margin-top:6px"></div>
          <video id="video" controls playsinline preload="metadata" disableremoteplayback hidden></video>
          <div class="hbar" id="hb1" role="slider" tabindex="0" aria-label="Motor 1 level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fill"></div><span class="lab">Motor 1</span><span class="pct">0%</span></div>
          <div class="hbar m2" id="hb2" role="slider" tabindex="0" aria-label="Motor 2 level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div class="fill"></div><span class="lab">Motor 2</span><span class="pct">0%</span></div>
          <div class="vrecrow"><button id="vrec" class="vrec" type="button">● Rec</button><label class="check"><input id="vspring" type="checkbox" checked> Drop to 0 on release</label><span class="vrecinfo" id="vrecinfo"></span></div>
          <div class="stlive"><span class="gpslot"></span></div>
          <div class="row" id="vrecdone" style="margin-top:6px" hidden><button id="vrecuse">Use as take</button><button id="vrecdl">Download .funscript</button><button id="vrecclear" class="stop">Clear</button></div>
          <div class="vstat" id="vstat"></div>
          <div class="row" style="margin-top:8px"><button id="vgo" class="go">▶ Go</button><button id="vcast" type="button" style="flex:0 0 96px" title="Play the video on a TV or Chromecast through Home Assistant">📺 Cast</button><button id="vstop" class="stop" style="flex:0 0 96px">■ Stop</button></div>
          <div style="position:relative"><div class="rppop" id="castpop" style="top:4px" hidden><div id="castlist"></div></div></div>
          <label>Sync offset <span id="voffv"></span></label>
          <input id="voff" type="range" min="-1000" max="1000" step="25" value="150">
          <div class="hint">Positive values send each moment slightly early to make up for Bluetooth delay. Pause, seek and playback speed all stay in sync.</div>
          <div class="hint">To make a script for this video: press ● Rec, play the video and drag the slider (position in the Stroke view, intensity in Vibrate). You can pause, scrub back and record a section again; the newer pass replaces it. While a script plays, the slider shows it; hold the slider to take over until you let go.</div>
        </section>
        <section data-part="import">
          <h3>Import</h3>
          <textarea id="paste" placeholder="Paste a funscript, an ogg1: code, or JSON"></textarea>
          <div class="row" style="margin-top:6px"><input id="files" type="file" accept=".funscript,.json,application/json" multiple></div>
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
      for (const b of this.shadowRoot.querySelectorAll(".kind button")) b.addEventListener("click", () => this._setRecKind(b.dataset.kind));
      $("device").addEventListener("change", () => {
        this._deviceId = $("device").value;
        this._rememberDevice(this._device || { id: NO_DEVICE, name: "" });
        this._update();
      });
      this._vals = [0, 0];
      this._bindPad($("pad1"), 0);
      this._bindPad($("pad2"), 1);
      $("rec").addEventListener("click", () => this._recording ? this._stopRecording() : this._startRecording());
      $("live").addEventListener("change", () => this._setLive($("live").checked));
      $("takeplay").addEventListener("click", () => this._play(this._take));
      $("takestop").addEventListener("click", () => this._stop());
      $("takecode").addEventListener("click", () => this._copy(this._take));
      $("takedl").addEventListener("click", () => this._download(this._take, $("name").value.trim() || this._take && this._take.metadata && this._take.metadata.title || "oggstudio"));
      $("takediscard").addEventListener("click", () => {
        this._take = null;
        this._update();
      });
      $("save").addEventListener("click", () => this._save());
      $("play").addEventListener("click", () => this._playSaved());
      $("stop").addEventListener("click", () => this._stop());
      $("code").addEventListener("click", () => this._copySaved());
      $("delete").addEventListener("click", () => this._delete());
      $("saved").addEventListener("change", () => this._hass.callService("select", "select_option", { entity_id: this._studio.saved, option: $("saved").value }));
      $("speed").addEventListener("change", () => this._hass.callService("select", "select_option", { entity_id: this._studio.speed, option: $("speed").value }));
      $("load").addEventListener("click", () => this._import());
      this._bindStroke();
      this._bindOutputs();
      this._bindReplay();
      this._bindTools();
      this._bindAudio();
      this._bindTogether();
      this._bindSafety();
      this._bindVideo();
      this._bindGamepad();
      this._update();
    }
  };

  // frontend/src/card/stroke.js
  var StrokePart = class {
    // ---------------------------------------------------------- stroke recorder
    _bindStroke() {
      const $ = this._el;
      const load = (key, fallback) => {
        try {
          const v = localStorage.getItem(key);
          return v === null ? fallback : JSON.parse(v);
        } catch (_) {
          return fallback;
        }
      };
      const lim = load(STROKE_LIMIT_KEY, null);
      const okLim = lim && Number.isFinite(lim.lower) && Number.isFinite(lim.upper) && lim.upper - lim.lower >= 2;
      this._st = {
        pos: 50,
        dir: 1,
        vel: 0,
        pad: null,
        touch: null,
        latch: null,
        drag: null,
        moving: null,
        ...okLim ? { lower: lim.lower, upper: lim.upper, last: lim.last || null } : { ...STROKE_LIMITS_RESET }
      };
      this._stRecording = false;
      $("stlive").addEventListener("change", () => {
        if ($("stlive").checked) this._stRun();
      });
      $("strec").addEventListener("click", () => this._stRecording ? this._stStop() : this._stStart());
      $("stlimit").addEventListener("click", () => this._stSetLimit());
      $("streset").addEventListener("click", () => this._stReset());
      const pcts = load(STROKE_SPEED_KEY, null);
      this._stPcts = STROKE_SPEEDS.map((sp, i) => Array.isArray(pcts) && okPct(pcts[i]) ? pcts[i] : sp.pct);
      for (const r of this.shadowRoot.querySelectorAll(".stpctr")) {
        const i = Number(r.dataset.speed);
        r.value = String(this._stPcts[i]);
        r.title = "";
        r.addEventListener("input", () => {
          this._stPcts[i] = Number(r.value);
          this._stShow();
          this._gpStatus();
        });
        r.addEventListener("change", () => this._gpSave(STROKE_SPEED_KEY, this._stPcts));
      }
      for (const btn of this.shadowRoot.querySelectorAll(".stlatch")) {
        const i = Number(btn.dataset.speed);
        btn.addEventListener("click", () => {
          this._st.latch = this._st.latch === i ? null : i;
          this._stRun();
        });
      }
      for (const btn of this.shadowRoot.querySelectorAll(".sthold")) {
        const speed = Number(btn.dataset.speed);
        const release = () => {
          if (this._st.touch === speed) {
            this._st.touch = null;
            this._stRun();
          }
        };
        const press = () => {
          if (this._st.latch === speed) this._st.latch = null;
          this._st.touch = speed;
          this._stRun();
        };
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          capture(btn, e);
          press();
        });
        for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) btn.addEventListener(type, release);
        btn.addEventListener("contextmenu", (e) => e.preventDefault());
        btn.addEventListener("keydown", (e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            press();
          }
        });
        btn.addEventListener("keyup", (e) => {
          if (e.key === " " || e.key === "Enter") release();
        });
      }
      const level = (el, e) => {
        const r = el.getBoundingClientRect();
        return Math.min(100, Math.max(0, (1 - (e.clientY - r.top) / r.height) * 100));
      };
      const lane = $("stlane");
      lane.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        capture(lane, e);
        lane.classList.add("active");
        this._st.caught = false;
        this._st.drag = level(lane, e);
        this._stRun();
      });
      lane.addEventListener("pointermove", (e) => {
        if (this._st.drag !== null) this._st.drag = level(lane, e);
      });
      const laneUp = () => {
        if (this._st.drag === null) return;
        this._st.drag = null;
        lane.classList.remove("active");
        this._stRun();
      };
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) lane.addEventListener(type, laneUp);
      lane.addEventListener("contextmenu", (e) => e.preventDefault());
      lane.addEventListener("keydown", (e) => {
        const steps = { ArrowUp: 2, ArrowDown: -2, PageUp: 10, PageDown: -10 };
        if (e.key in steps) {
          e.preventDefault();
          e.stopPropagation();
          this._st.pos = Math.min(100, Math.max(0, this._st.pos + steps[e.key]));
          this._stMark();
          this._stRun();
        }
      });
      const rail = $("strail");
      let grab = null;
      rail.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        capture(rail, e);
        rail.classList.add("active");
        const v = level(rail, e);
        grab = railGrab(this._st, v, 22 / rail.getBoundingClientRect().height * 100);
        if (grab.mode !== "move") Object.assign(this._st, railDrag(this._st, grab, v));
        this._stShow();
      });
      rail.addEventListener("pointermove", (e) => {
        if (!grab) return;
        Object.assign(this._st, railDrag(this._st, grab, level(rail, e)));
        this._stShow();
      });
      const railUp = () => {
        if (!grab) return;
        if (grab.mode !== "move") this._st.last = grab.mode;
        grab = null;
        rail.classList.remove("active");
        this._stSaveLimits();
        this._stShow();
      };
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) rail.addEventListener(type, railUp);
      rail.addEventListener("contextmenu", (e) => e.preventDefault());
      rail.addEventListener("keydown", (e) => {
        const steps = { ArrowUp: 2, ArrowDown: -2, PageUp: 10, PageDown: -10 };
        if (!(e.key in steps)) return;
        e.preventDefault();
        e.stopPropagation();
        Object.assign(this._st, railDrag(this._st, { mode: "move", off: 0 }, this._st.lower + steps[e.key]));
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
      if (!this._st || this._stTimer || !this.isConnected) {
        this._stShow();
        return;
      }
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
        this._stMark(now - dt);
        st.moving = speed;
      }
      if (speed !== null) st.lastSpeed = speed;
      if (speed !== null) {
        const r = strokeStep(st.pos, st.dir, st.lower, st.upper, strokeVel(this._stPcts[speed]), dt);
        for (const t of r.turns) this._stMark(now - dt + t.frac * dt, t.pos);
        st.pos = r.pos;
        st.dir = r.dir;
      } else if (st.drag !== null) {
        if (st.caught) st.pos = st.drag;
        else {
          const r = approachStep(st.pos, st.drag, strokeVel(this._stPcts[st.lastSpeed ?? 0]), dt);
          st.pos = r.pos;
          st.caught = r.caught;
        }
        if (Math.abs(st.pos - before) > 0.5 && now - (this._stDragMark || 0) >= 50) {
          this._stDragMark = now;
          this._stMark(now);
        }
      } else if (this._rp && this._rp.playing) {
        st.pos = this._rpPos();
      }
      const vel = dt > 0 ? (st.pos - before) / dt * 1e3 : 0;
      st.vel = st.vel * 0.6 + vel * 0.4;
      if (speed !== null) st.dir = st.dir || 1;
      this._stLive(now);
      this._stShow();
      const busy = speed !== null || st.drag !== null || this._stRecording || this._el("stlive").checked || Boolean(this._rp && this._rp.playing);
      if (!busy) this._stHalt();
    }
    _stHalt() {
      clearInterval(this._stTimer);
      this._stTimer = null;
      if (this._stOutAt) {
        this._stOutAt = 0;
        this._outStop();
      }
    }
    // Live feedback: a vibration device follows the stroke using the chosen
    // run mode, sent at most every 100 ms (and refreshed every 500 ms).
    // Live: every output follows the stroke its own way, at most every 100 ms.
    // A vibrator gets an intensity from its run mode; a stroker gets the next
    // limit and how long to take (or the bar position when moved by hand).
    _stLive(now) {
      const replaying = Boolean(this._rp && this._rp.playing);
      const on = this._stRecording || this._el("stlive").checked || replaying;
      if (!on) {
        if (this._stOutAt) {
          this._stOutAt = 0;
          this._outStop();
        }
        return;
      }
      const full = !this._stOutAt || now - this._stOutAt >= 100;
      if (full) this._stOutAt = now;
      const st = this._st;
      const speed = this._stSpeed();
      const fromScript = replaying && speed === null && st.drag === null;
      const values = this._outs.map((o, i) => {
        const p = parseTarget(this._outTargetValue(i));
        if (!p || !full && p.motor !== "l") return null;
        if (fromScript && this._rp.raw.mood && p.motor !== "l") return this._mapScript(this._rp.raw, this._rp.t, {})[i];
        if (o.m === FOLLOW_AI && p.motor !== "l") {
          if (fromScript) return this._mapScript(this._rp.raw, this._rp.t, this._rp.convs || (this._rp.convs = {}))[i];
          return this._aiStroke(i, st.pos, st.vel);
        }
        if (p.motor === "l" || o.m === FOLLOW_STROKER) {
          if (p.motor !== "l") return Math.round(st.pos);
          if (fromScript) return this._goalFrom(i, this._rp.raw, this._rp.t, this._rpSpeed(), this._rp.convs || (this._rp.convs = {})) || { goal: st.pos, dur: 120 };
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
      if (last && at <= last.at) last.pos = p;
      else acts.push({ at, pos: p });
    }
    _stStart() {
      if (this._stRecording) return;
      this._stRecording = true;
      this._st0 = performance.now();
      this._stActs = [];
      this._stMark(this._st0);
      this._stRun();
      this._toast("Recording: hold a speed to stroke.");
    }
    _stStop() {
      if (!this._stRecording) return;
      this._stMark();
      this._stRecording = false;
      const acts = this._stActs;
      this._stActs = [];
      if (acts.length < 2 || acts[acts.length - 1].at < 200) {
        this._toast("Nothing recorded.");
        this._stShow();
        return;
      }
      this._take = { version: "1.0", inverted: false, range: 100, actions: acts, metadata: { creator: "OggStudio", type: "stroke" } };
      const m = this._outs[0].m;
      this._el("takemode").value = RUN_MODES[m] ? m : RUN_MODE_DEFAULT;
      this._toast(`Recorded ${fmt(duration(this._take))} of strokes. Save it below, or download the .funscript for a Handy.`);
      this._update();
      this._stRun();
    }
    _stSetLimit() {
      const st = this._st;
      const next = strokeSetLimit(st, st.pos);
      if (!next) {
        this._toast("That is where the other limit is: move first, then set the limit.");
        return;
      }
      Object.assign(st, next);
      this._stSaveLimits();
      this._toast(`${next.last === "upper" ? "Upper" : "Lower"} limit set: range ${st.lower}–${st.upper}.`);
      this._stShow();
    }
    _stSaveLimits() {
      const st = this._st;
      this._gpSave(STROKE_LIMIT_KEY, { lower: st.lower, upper: st.upper, last: st.last });
    }
    _stReset() {
      Object.assign(this._st, STROKE_LIMITS_RESET);
      this._gpSave(STROKE_LIMIT_KEY, null);
      this._toast("Limits reset: full range 0–100.");
      this._stShow();
    }
    _stShow() {
      if (!this._el || !this._st) return;
      const $ = this._el;
      const st = this._st;
      const pos = Math.round(st.pos);
      for (const id of ["stband", "stshade"]) {
        $(id).style.top = `${100 - st.upper}%`;
        $(id).style.height = `${st.upper - st.lower}%`;
      }
      $("stpos").style.bottom = `${st.pos}%`;
      $("stup").style.top = st.upper > 90 ? `calc(${100 - st.upper}% + 6px)` : `calc(${100 - st.upper}% - 18px)`;
      $("stup").textContent = String(st.upper);
      $("stlo").style.bottom = st.lower < 10 ? `calc(${st.lower}% + 6px)` : `calc(${st.lower}% - 18px)`;
      $("stlo").textContent = String(st.lower);
      $("stpct").textContent = String(pos);
      $("stlane").setAttribute("aria-valuenow", String(pos));
      $("strail").setAttribute("aria-valuetext", `range ${st.lower} to ${st.upper}`);
      const speed = this._stSpeed();
      for (const b of this.shadowRoot.querySelectorAll(".sthold")) b.classList.toggle("on", Number(b.dataset.speed) === speed);
      for (const b of this.shadowRoot.querySelectorAll(".stpv")) {
        const t = `${this._stPcts[Number(b.dataset.speed)]}%`;
        if (b.textContent !== t) b.textContent = t;
      }
      for (const b of this.shadowRoot.querySelectorAll(".stlatch")) {
        const on = Number(b.dataset.speed) === st.latch;
        if (b.classList.contains("on") !== on) {
          b.classList.toggle("on", on);
          b.textContent = on ? "■ Latched" : "⟳ Latch";
          b.setAttribute("aria-pressed", String(on));
        }
      }
      $("strec").textContent = this._stRecording ? "■ Stop recording" : "● Record";
      $("strec").classList.toggle("on", this._stRecording);
      const bits = [`Range ${st.lower}–${st.upper}`];
      if (speed !== null) bits.push(`${STROKE_SPEEDS[speed].name} ${this._stPcts[speed]}%${st.latch === speed && st.touch === null && st.pad === null ? " (latched)" : ""}`);
      if (this._stRecording) bits.push(`● ${fmt(performance.now() - this._st0)}`);
      if (this._outs && !this._outs.some((o, i) => parseTarget(this._outTargetValue(i)))) bits.push("no device: recording only");
      const text = bits.join(" · ");
      if ($("stinfo").textContent !== text) $("stinfo").textContent = text;
    }
  };

  // frontend/src/card/gamepad.js
  var GamepadPart = class {
    // ---------------------------------------------------------- game controller
    _bindGamepad() {
      const $ = this._el;
      const parts = this._baseParts;
      $("gp").hidden = !(parts.includes("record") || parts.includes("video") || parts.includes("stroke"));
      this._gpLearning = null;
      this._gpStatusHtml = null;
      const load = (key, fallback) => {
        try {
          const v = localStorage.getItem(key);
          return v === null ? fallback : JSON.parse(v);
        } catch (_) {
          return fallback;
        }
      };
      this._gpMaps = {};
      for (const [name, prof] of Object.entries(GP_PROFILES)) {
        const map = load(prof.mapKey, null);
        this._gpMaps[name] = map && typeof map === "object" ? gpBuildMap(map, prof.defaults) : { ...prof.defaults };
      }
      const speed = Number(load(GP_SPEED_KEY, GP_SPEED_DEFAULT));
      this._gpSpeed = Number.isInteger(speed) && speed >= 0 && speed < GP_SPEEDS.length ? speed : GP_SPEED_DEFAULT;
      $("gpon").checked = load(GP_ON_KEY, false) === true;
      $("gpon").addEventListener("change", () => {
        this._gpSave(GP_ON_KEY, $("gpon").checked);
        gpState.owner = this;
        this._gpRun();
        this._gpStatus();
      });
      $("gplearnbtn").addEventListener("click", () => this._gpLearnStart());
      $("gpskip").addEventListener("click", () => this._gpLearnSkip());
      $("gpreset").addEventListener("click", () => {
        this._gpSave(this._gpProf.mapKey, null);
        this._gpMap = { ...this._gpProf.defaults };
        this._gpLearnEnd("Controller: default controls restored.");
      });
      $("gpcancel").addEventListener("click", () => this._gpLearnEnd(""));
      this._gpStatus();
      this._gpRun();
    }
    connectedCallback() {
      this._gpAttach();
    }
    _gpAttach() {
      if (this._gpHandlers) return;
      const typing = (e) => {
        const t = e.composedPath ? e.composedPath()[0] : e.target;
        return Boolean(t && (t.isContentEditable || /^(TEXTAREA|SELECT)$/.test(t.tagName) || t.tagName === "INPUT" && t.type !== "checkbox"));
      };
      const names = (e) => [e.code, e.key].filter(Boolean);
      const h = {
        keydown: (e) => {
          if (!this._el || typing(e)) return;
          if (this._gpLearning) {
            if (e.key === "Tab") return;
            e.preventDefault();
            e.stopPropagation();
            if (e.repeat) return;
            if (this._gpPad()) {
              this._gpLearning.keys = (this._gpLearning.keys || 0) + 1;
              if (this._gpLearning.keys <= 3) this._gpLog(`key ignored while learning (gamepad present): code=${e.code} key=${e.key}`);
              return;
            }
            this._gpLearnKey(e.code || e.key);
            return;
          }
          if (!this._el("gpon").checked || !this._gpUsable() || !this._gpIsOwner()) return;
          const n = names(e);
          if (!Object.values(this._gpMap).some((binds) => binds.some((b) => b.k !== void 0 && n.includes(b.k)))) return;
          e.preventDefault();
          e.stopPropagation();
          if (this._gpPad()) return;
          n.forEach((k) => this._gpKeys.add(k));
          this._gpRun();
        },
        keyup: (e) => {
          names(e).forEach((k) => this._gpKeys.delete(k));
        },
        blur: () => this._gpKeys.clear(),
        connected: (e) => {
          if (!this._el || !this._gpUsable()) return;
          if (!this._el("gpon").checked) {
            this._el("gpon").checked = true;
            this._gpSave(GP_ON_KEY, true);
          }
          this._toast(`Controller connected: ${e.gamepad && e.gamepad.id ? e.gamepad.id : "game controller"}`);
          if (gpState.owner === this || !gpState.owner) this._gpLogPads();
          this._gpRun();
          this._gpStatus();
        },
        disconnected: () => {
          this._gpFloat = [null, null];
          this._gpStatus();
        }
      };
      window.addEventListener("keydown", h.keydown, true);
      window.addEventListener("keyup", h.keyup, true);
      window.addEventListener("blur", h.blur);
      window.addEventListener("gamepadconnected", h.connected);
      window.addEventListener("gamepaddisconnected", h.disconnected);
      this._gpHandlers = h;
      this._gpRun();
    }
    _gpDetach() {
      const h = this._gpHandlers;
      if (h) {
        window.removeEventListener("keydown", h.keydown, true);
        window.removeEventListener("keyup", h.keyup, true);
        window.removeEventListener("blur", h.blur);
        window.removeEventListener("gamepadconnected", h.connected);
        window.removeEventListener("gamepaddisconnected", h.disconnected);
      }
      this._gpHandlers = null;
      clearInterval(this._gpTimer);
      this._gpTimer = null;
      this._gpKeys.clear();
      if (gpState.owner === this) gpState.owner = null;
    }
    _gpSave(key, value) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {
      }
    }
    _gpUsable() {
      return Boolean(this._el && this.isConnected && !this._el("gp").hidden);
    }
    _gpIsOwner() {
      if (gpState.owner && gpState.owner !== this && gpState.owner._gpUsable() && gpState.owner._el("gpon").checked) return false;
      gpState.owner = this;
      return true;
    }
    _gpPad() {
      let pads = [];
      try {
        pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
        this._gpBlocked = false;
      } catch (_) {
        this._gpBlocked = true;
      }
      this._gpPrevPressed = this._gpPrevPressed || {};
      for (const p of pads) {
        if (!p || !p.connected) continue;
        const now = gpPressed(p);
        const before = this._gpPrevPressed[p.index];
        if (before && now.some((i) => !before.includes(i))) this._gpActive = p.index;
        this._gpPrevPressed[p.index] = now;
      }
      this._gpPadCount = pads.filter((p) => p && p.connected).length;
      return gpChoosePad(pads, this._gpActive);
    }
    // Learn controls reports what it sees to the Home Assistant log
    // (Settings > System > Logs), so a controller's quirks can be diagnosed.
    _gpLog(message) {
      if (!this._hass) return;
      this._hass.callService("system_log", "write", { message: `OggStudio controller: ${message}`, level: "warning", logger: "oggstudio.card" }, void 0, false).catch(() => {
      });
    }
    _gpLogPads() {
      let pads = [];
      try {
        pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];
      } catch (_) {
      }
      const live = pads.filter((p) => p && p.connected);
      this._gpLog(`${live.length} gamepad(s): ${live.map((p) => gpRaw(p)).join(" || ") || "none"} · chosen #${this._gpPad() ? this._gpPad().index : "-"} · secure=${window.isSecureContext} · ${navigator.userAgent}`);
    }
    _gpTarget() {
      return gpTargetFor(this._parts, Boolean(this._vurl));
    }
    // The stroke recorder has its own controls (and its own learned map).
    get _gpProfName() {
      return this._gpLearning ? this._gpLearning.prof : this._gpTarget() === "stroke" ? "stroke" : "level";
    }
    get _gpProf() {
      return GP_PROFILES[this._gpProfName];
    }
    get _gpMap() {
      return this._gpMaps[this._gpProfName];
    }
    set _gpMap(map) {
      this._gpMaps[this._gpProfName] = map;
    }
    // Polls the controller every GP_POLL_MS while it is on (or learning).
    // A timer rather than animation frames: those stall in some web views.
    _gpRun() {
      if (this._gpTimer || !this._el || !this.isConnected) return;
      this._gpLast = performance.now();
      this._gpTimer = setInterval(() => {
        if (!this._el || !this.isConnected || !this._el("gpon").checked && !this._gpLearning) {
          clearInterval(this._gpTimer);
          this._gpTimer = null;
          this._gpKeys.clear();
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
      this._gpPadId = pad ? pad.id : "";
      if (this._gpLearning) {
        this._gpLearnPoll(pad);
        return;
      }
      if (!this._gpUsable() || !this._gpIsOwner()) return;
      const s = gpRead(this._gpMap, pad, this._gpKeys);
      const pressed = (a) => s[a] > 0.5 && !(this._gpPrev[a] > 0.5);
      if (pressed("panic")) {
        this._gpPrev = s;
        this._panic();
        return;
      }
      if (this._gpProfName === "stroke") {
        if (pressed("rec")) this._gpRec();
        if (pressed("limit")) this._stSetLimit();
        if (pressed("reset")) this._stReset();
        const held = s.fast > 0.5 ? 2 : s.med > 0.5 ? 1 : s.slow > 0.5 ? 0 : null;
        if (held !== this._st.pad) {
          if (held !== null && held === this._st.latch) this._st.latch = null;
          this._st.pad = held;
          this._stRun();
        }
        this._gpPrev = s;
        this._gpStatus();
        return;
      }
      if (pressed("right")) this._gpSetSpeed(1);
      if (pressed("left")) this._gpSetSpeed(-1);
      if (pressed("motor")) this._gpCycleMotor();
      if (pressed("rec")) this._gpRec();
      const target = this._gpTarget();
      if (target && pressed("zero")) {
        this._gpFloat = [null, null];
        this._gpApply(target, () => 0);
      } else if (target && (s.up || s.down)) {
        const speed = GP_SPEEDS[this._gpSpeed];
        this._gpApply(target, (v, i) => this._gpFloat[i] = gpStep(this._gpFloat[i] ?? v, s.up, s.down, speed, dt));
      } else {
        this._gpFloat = [null, null];
      }
      this._gpPrev = s;
      this._gpStatus();
    }
    _gpMotors() {
      if (this._gpTarget() === "video" || !this._twoPads) return [0];
      return this._gpMotor === 2 ? [0, 1] : [this._gpMotor];
    }
    _gpApply(target, fn) {
      const motors = this._gpMotors();
      if (target === "video") {
        if (!this._vrec) {
          this._gpHint("Controller: press record first to record against the video");
          return;
        }
        for (const i of motors) {
          this._hvals[i] = Math.round(Math.min(100, Math.max(0, fn(this._hvals[i], i))));
          this._showHBar(i, this._hvals[i]);
        }
      } else {
        for (const i of motors) this._setPad(i, fn(this._vals[i], i));
      }
    }
    _gpHint(text) {
      if (this._gpHinted === text) return;
      this._gpHinted = text;
      this._toast(text);
      clearTimeout(this._gpHintTimer);
      this._gpHintTimer = setTimeout(() => {
        this._gpHinted = null;
      }, 4e3);
    }
    _gpSetSpeed(delta) {
      this._gpSpeed = Math.min(GP_SPEEDS.length - 1, Math.max(0, this._gpSpeed + delta));
      this._gpSave(GP_SPEED_KEY, this._gpSpeed);
    }
    _gpCycleMotor() {
      if (this._gpTarget() === "video" || !this._twoPads) return;
      this._gpMotor = (this._gpMotor + 1) % 3;
      this._gpFloat = [null, null];
    }
    _gpRec() {
      const $ = this._el;
      const target = this._gpTarget();
      if ((target === "stroke" || target === "record") && this._ctl === "mood") {
        if (this._rp.playing) this._rpStop();
        else if (this._mood) this._moodNext(true);
      } else if ((target === "stroke" || target === "record") && this._ctl === "replay") {
        this._rpToggle();
      } else if (target === "stroke") {
        if (this._stRecording) this._stStop();
        else this._stStart();
      } else if (target === "video") {
        this._vrecToggle();
        const video = $("video");
        if (this._vrec && video.paused) this._videoGo();
        else if (!this._vrec && !video.paused) video.pause();
      } else if (target === "record") {
        if ($("rec").disabled) {
          this._toast("The device is not connected");
          return;
        }
        if (this._recording) this._stopRecording();
        else this._startRecording();
      }
    }
    _gpStatus() {
      if (!this._el) return;
      const $ = this._el;
      const open = $("gpon").checked || Boolean(this._gpLearning);
      if ($("gpmore").hidden === open) {
        $("gpmore").hidden = !open;
        $("gp").classList.toggle("on", open);
      }
      let html = "";
      const stroke = this._gpProfName === "stroke";
      if (this._gpLearning) html = "";
      else if (!$("gpon").checked) html = stroke ? "Hold a speed to stroke, set and reset limits, record" : "Up/down = level, left/right = speed, A = record";
      else if (stroke) {
        const st = this._st;
        const sp = this._stSpeed();
        const bits = [sp !== null && sp !== void 0 ? `<b>${STROKE_SPEEDS[sp].name} ${this._stPcts[sp]}%</b>` : "hold a speed to stroke"];
        if (this._gpPadId) bits.push(esc(this._gpPadId.replace(/\s*\(.*$/, "").slice(0, 28)) + (this._gpPadCount > 1 && this._gpActive === void 0 ? ` (1 of ${this._gpPadCount}: press a button to choose)` : ""));
        else if (this._gpBlocked || !window.isSecureContext) bits.push("no gamepad: this page is not HTTPS, so only keyboard-mode controllers work");
        else bits.push("press a button on the controller");
        html = bits.join(" · ");
      } else {
        const bits = [`Speed <b>${this._gpSpeed + 1}/${GP_SPEEDS.length}</b> (${GP_SPEEDS[this._gpSpeed]}%/s)`];
        if (this._gpTarget() !== "video" && this._twoPads) bits.push(["Pad 1", "Pad 2", "Both pads"][this._gpMotor]);
        const target = this._gpTarget();
        bits.push(target === "video" ? "→ video" : target === "record" ? "→ pads" : "");
        if (this._gpPadId) bits.push(esc(this._gpPadId.replace(/\s*\(.*$/, "").slice(0, 28)) + (this._gpPadCount > 1 && this._gpActive === void 0 ? ` (1 of ${this._gpPadCount}: press a button to choose)` : ""));
        else if (this._gpBlocked || !window.isSecureContext) bits.push("no gamepad: this page is not HTTPS, so only keyboard-mode controllers work");
        else bits.push("press a button on the controller");
        html = bits.filter(Boolean).join(" · ");
      }
      if (this._gpStatusHtml !== html) {
        this._gpStatusHtml = html;
        $("gpstat").innerHTML = html;
      }
    }
    // Learn controls: (1) hands off while axes are measured, (2) press the
    // button for Record, (3) for each other control: hold it, press Record.
    _gpLearnStart() {
      const $ = this._el;
      if (!$("gpon").checked) {
        $("gpon").checked = true;
        this._gpSave(GP_ON_KEY, true);
      }
      this._gpLearning = { prof: this._gpProfName, phase: "wake", learned: {}, step: 0, samples: [], cal: null, recBtn: -1, recKey: null, wait: true, last: "" };
      $("gplearn").hidden = false;
      $("gplearnrow").hidden = false;
      $("gpraw").hidden = false;
      $("gplearnbtn").hidden = true;
      this._gpLog("learn started");
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
        wake: "Press any button on the controller to wake it, then let go. (Keyboard-mode controller: press the key you want for Record.)",
        rest: "Hands off the controller for a moment...",
        rec: "Press the button you want for Record start/stop.",
        hold: `${L.step + 1}/${this._gpProf.hold.length}: hold ${this._gpProf.labels[this._gpProf.hold[L.step]].toUpperCase()}, then press Record (${recName}) to confirm. Nothing held, or Skip = keep the default.`
      }[L.phase];
      const t = (L.last ? `✓ ${L.last}. ` : "") + text;
      if (this._el("gplearn").textContent !== t) this._el("gplearn").textContent = t;
    }
    _gpLearnPoll(pad) {
      const L = this._gpLearning;
      L.ticks = (L.ticks || 0) + 1;
      if (L.ticks % 5 === 0 && this._el) this._el("gpraw").textContent = `${gpRaw(pad)}${this._gpPadCount > 1 ? ` (of ${this._gpPadCount} gamepads)` : ""}`;
      if (L.phase === "wake") {
        if (pad) {
          L.phase = "rest";
          L.samples = [];
          L.restPressed = null;
          this._gpLearnShow();
        }
        return;
      }
      if (!pad) return;
      if (L.phase === "rest") {
        const pressed = gpPressed(pad).join(",");
        if (pressed !== L.restPressed) {
          L.restPressed = pressed;
          L.samples = [];
        }
        L.samples.push([...pad.axes]);
        if (L.samples.length >= GP_REST_SAMPLES) {
          L.cal = gpCalibrate(L.samples);
          L.cal.stuck = gpPressed(pad);
          L.padIndex = pad.index;
          L.phase = "rec";
          L.wait = true;
          this._gpLog(`calibrated pad #${pad.index}: rest [${L.cal.rest.map((v) => v.toFixed(2)).join(" ")}] jitter [${L.cal.noise.map((v) => v.toFixed(2)).join(" ")}] stuck buttons [${L.cal.stuck.join(",")}]`);
          this._gpLearnShow();
        }
        return;
      }
      const stuck = L.cal ? L.cal.stuck : [];
      if (L.phase === "rec") {
        const b = gpFirstButton(pad, -1, stuck);
        if (L.wait) {
          if (b < 0) L.wait = false;
          return;
        }
        if (b >= 0) {
          this._gpLog(`record button: ${gpRaw(pad)}`);
          this._gpLearnSetRec({ b });
        }
        return;
      }
      const recDown = L.recBtn >= 0 && !stuck.includes(L.recBtn) && Boolean(pad.buttons[L.recBtn] && pad.buttons[L.recBtn].pressed);
      if (L.wait) {
        if (!recDown) L.wait = false;
        return;
      }
      if (recDown) {
        const bind = gpPickInput(pad, L.cal, L.recBtn);
        this._gpLog(`${this._gpProf.hold[L.step]} confirmed -> ${gpDescribe(bind)} · ${gpRaw(pad)}`);
        this._gpLearnNext(bind);
      }
    }
    _gpLearnSetRec(bind) {
      const L = this._gpLearning;
      L.learned.rec = [bind];
      if (bind.b !== void 0) L.recBtn = bind.b;
      else L.recKey = bind.k;
      L.last = `Record = ${gpDescribe(bind)}`;
      L.phase = "hold";
      L.step = 0;
      L.wait = true;
      this._gpLearnShow();
    }
    // Keys while learning: a key for Record (keyboard-mode pads), the Record
    // key confirms what is held, any other key binds straight away.
    _gpLearnKey(k) {
      const L = this._gpLearning;
      if (L.phase !== "hold") {
        this._gpLearnSetRec({ k });
        return;
      }
      if (k === L.recKey) this._gpLearnNext(gpPickInput(this._gpPad(), L.cal, L.recBtn));
      else this._gpLearnNext({ k });
    }
    _gpLearnSkip() {
      const L = this._gpLearning;
      if (!L) return;
      if (L.phase === "hold") {
        this._gpLearnNext(null);
        return;
      }
      L.recBtn = 0;
      L.last = "Record = button 0 (default)";
      if (!L.cal && L.samples.length) {
        L.cal = gpCalibrate(L.samples);
        L.cal.stuck = [];
      }
      L.phase = "hold";
      L.step = 0;
      L.wait = true;
      this._gpLearnShow();
    }
    _gpLearnNext(bind) {
      const L = this._gpLearning;
      if (!L || L.phase !== "hold") return;
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
      if (L.step < prof.hold.length) {
        this._gpLearnShow();
        return;
      }
      this._gpSave(prof.mapKey, L.learned);
      this._gpMap = gpBuildMap(L.learned, prof.defaults);
      this._gpLog(`learn finished: ${JSON.stringify(L.learned)}`);
      this._gpLearnEnd("Controller: controls saved for this browser.");
    }
    _gpLearnEnd(message) {
      const $ = this._el;
      const map = this._gpMap;
      this._gpLearning = null;
      $("gplearn").hidden = true;
      $("gplearnrow").hidden = true;
      $("gpraw").hidden = true;
      $("gplearnbtn").hidden = false;
      this._gpPrev = Object.fromEntries([...GP_ACTIONS, ...ST_ACTIONS, ...Object.keys(map)].map((a) => [a, 1]));
      this._gpKeys.clear();
      this._toast(message);
      this._gpStatus();
    }
  };

  // frontend/src/card/video.js
  var VideoPart = class {
    // ---------------------------------------------------------- video sync
    _bindVideo() {
      const $ = this._el;
      const video = $("video");
      let offset = 150;
      try {
        const saved = Number(localStorage.getItem(VIDEO_OFFSET_KEY));
        if (Number.isFinite(saved) && localStorage.getItem(VIDEO_OFFSET_KEY) !== null) offset = saved;
      } catch (_) {
      }
      $("voff").value = String(offset);
      const showOffset = () => {
        $("voffv").textContent = `${Number($("voff").value) > 0 ? "+" : ""}${$("voff").value} ms`;
      };
      showOffset();
      $("voff").addEventListener("input", () => {
        showOffset();
        try {
          localStorage.setItem(VIDEO_OFFSET_KEY, $("voff").value);
        } catch (_) {
        }
        this._videoSend(true);
      });
      $("vfile").addEventListener("change", () => {
        const file = $("vfile").files[0];
        this._vname = file ? file.name.replace(/\.[^.]+$/, "") : "";
        this._vfileObj = file || null;
        if (this._cast) this._castEnd(true);
        this._videoHalt();
        if (this._vrec) this._vrecToggle();
        if (this._vrecHas()) this._vrecReset();
        if (this._vurl) URL.revokeObjectURL(this._vurl);
        this._vurl = file ? URL.createObjectURL(file) : null;
        video.hidden = !file;
        if (file) {
          video.src = this._vurl;
          video.load();
        } else {
          video.removeAttribute("src");
        }
        this._videoStatus();
      });
      $("vsrc").addEventListener("change", () => this._loadVideoScript());
      $("vscriptfile").addEventListener("change", () => this._loadVideoScript());
      $("vgo").addEventListener("click", () => this._videoGo());
      $("vstop").addEventListener("click", () => {
        if (this._cast) this._castEnd(true);
        video.pause();
        try {
          video.currentTime = 0;
        } catch (_) {
        }
        this._videoHalt();
      });
      video.addEventListener("play", () => this._castCmd("media_play"));
      video.addEventListener("pause", () => {
        if (!video.ended) this._castCmd("media_pause");
      });
      video.addEventListener("seeked", () => this._castCmd("media_seek", { seek_position: Math.round(video.currentTime * 10) / 10 }));
      video.addEventListener("play", () => this._videoRun());
      video.addEventListener("playing", () => this._videoRun());
      video.addEventListener("pause", () => this._videoHalt());
      video.addEventListener("ended", () => this._videoHalt());
      video.addEventListener("emptied", () => this._videoHalt());
      video.addEventListener("seeked", () => this._videoSend(true));
      video.addEventListener("timeupdate", () => this._videoStatus());
      video.addEventListener("loadedmetadata", () => this._videoStatus());
      this._hvals = [0, 0];
      this._vpasses = [[], []];
      this._bindHBar($("hb1"), 0);
      this._bindHBar($("hb2"), 1);
      video.addEventListener("seeking", () => this._vrecBreak());
      $("vrec").addEventListener("click", () => this._vrecToggle());
      $("vrecuse").addEventListener("click", () => this._vrecUse());
      $("vrecdl").addEventListener("click", () => this._vrecDownload());
      $("vrecclear").addEventListener("click", () => {
        if (confirm("Discard this recording?")) this._vrecReset();
      });
      this._bindCast();
    }
    async _loadVideoScript() {
      const $ = this._el;
      const fromFile = $("vsrc").value === "";
      $("vfilebox").hidden = !fromFile;
      this._vraw = null;
      try {
        if (fromFile) {
          const files = [...$("vscriptfile").files];
          if (!files.length) {
            this._vscript = null;
            this._videoStatus();
            return;
          }
          const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
          const first = parsed[0];
          if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
          this._vraw = normalise(first, fileKind(files[0].name, "auto"), Boolean(first.inverted));
          this._vscriptName = files[0].name;
        } else if ($("vsrc").value === TAKE_SRC) {
          if (!this._take) {
            this._vscript = null;
            this._videoStatus();
            return;
          }
          this._vraw = this._take;
          this._vscriptName = "Current take";
        } else {
          this._vraw = await this._getSaved($("vsrc").value);
          this._vscriptName = $("vsrc").value;
        }
        this._vscript = this._vraw;
        this._vconvs = {};
        if (!fromFile && $("vsrc").value !== TAKE_SRC) this._useRemembered($("vsrc").value, this._vraw);
        this._outRender();
        this._videoSend(true);
      } catch (e) {
        this._vscript = null;
        this._toast("Could not load the script: " + (e.message || e));
      }
      this._videoStatus();
    }
    // Is the outputs box in a recorder on this card? Then the video drives
    // those devices (with their follow modes); else the playback device.
    get _outsHere() {
      const box = this._el && this._el("outbox");
      return Boolean(box && box.parentElement && box.parentElement.classList.contains("outslot"));
    }
    // Video slider value: what it records, or what the script is doing now
    // (position for a stroke script in the stroke view, else intensity).
    _videoValue() {
      if (this._vrec || this._hbActive) return this._hvals[0];
      const video = this._el("video");
      const ms = video.currentTime * 1e3 + Number(this._el("voff").value || 0);
      if (!this._vraw) return 0;
      if (this._strokeKindRec && isStroke(this._vraw)) return sampleAt(this._vraw.actions, ms);
      return this._mapScript(this._vraw, ms, this._vconvs || (this._vconvs = {}))[0];
    }
    get _strokeKindRec() {
      return this._recKind === "stroke";
    }
    // Drive the follow-along devices from the video (outputs on this card).
    _videoOut() {
      if (this._au) return;
      const now = performance.now();
      const value = this._videoValue();
      const dt = now - (this._vOutAt || now);
      const vel = dt > 0 ? (value - (this._vOutPos ?? value)) / dt * 1e3 : 0;
      this._vOutAt = now;
      this._vOutPos = value;
      this._vVel = (this._vVel || 0) * 0.6 + vel * 0.4;
      const video = this._el("video");
      const ms = video.currentTime * 1e3 + Number(this._el("voff").value || 0);
      const script = !(this._vrec || this._hbActive) && this._vraw && isStroke(this._vraw);
      if (this._strokeKindRec) {
        const values = this._outs.map((o, i) => {
          const p = parseTarget(this._outTargetValue(i));
          if (!p) return null;
          const cache = this._vconvs || (this._vconvs = {});
          if (p.motor === "l") {
            return script && this._goalFrom(i, this._vraw, ms, video.playbackRate, cache) || { goal: value, dur: 120 };
          }
          if (o.m === FOLLOW_AI) return script ? this._mapScript(this._vraw, ms, cache)[i] : this._aiStroke(i, value, this._vVel);
          if (o.m === FOLLOW_STROKER) return value;
          return Math.min(100, Math.max(0, liveIntensity(o.m, value, this._vVel)));
        });
        this._outApply(values, 0.6);
        const st = this._st;
        if (st && st.drag === null && this._stSpeed() === null) {
          st.pos = value;
          this._stShow();
        }
      } else {
        const held = this._vrec || this._hbActive;
        if (held) {
          const h = this._hvals[0];
          for (const i of [0, 1]) if (!this._padActive || !this._padActive[i]) this._setPad(i, h);
          this._outApply([0, 1].map((i) => i && !this._twoPads ? null : this._mapLive(i, h, this._vVel)), 0.6);
          return;
        }
        const vals = this._mapScript(this._vraw || { actions: [] }, ms, this._vconvs || (this._vconvs = {}));
        for (const i of [0, 1]) if (!this._padActive || !this._padActive[i]) this._setPad(i, vals[i]);
        const out = [0, 1].map((i) => {
          if (i && !this._twoPads) return null;
          const p = parseTarget(this._outTargetValue(i));
          if (p && p.motor === "l") {
            return this._vraw && this._goalFrom(i, this._vraw, ms, video.playbackRate, this._vconvs || (this._vconvs = {})) || { goal: this._vals[i], dur: 150 };
          }
          return this._vals[i];
        });
        this._outApply(out, 0.6);
      }
    }
    _videoSend(force) {
      const video = this._el && this._el("video");
      if (!this._vsyncTimer || !video || video.paused) {
        this._videoStatus();
        return;
      }
      if (this._vrec) this._vrecSample();
      if (!this._vrec && !this._hbActive) this._showHBar(0, this._videoValue());
      this._videoOut();
      this._videoStatus();
    }
    _videoRun() {
      if (this._vsyncTimer || !(this._vscript || this._vrec)) return;
      if (this._rp) this._rpStop();
      if (this._live) {
        this._el("live").checked = false;
        this._setLive(false);
      }
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
      const bar = this._el("hb" + (index + 1));
      const v = Math.round(Math.min(100, Math.max(0, value)));
      bar.querySelector(".fill").style.width = v + "%";
      bar.querySelector(".pct").textContent = v + "%";
      bar.setAttribute("aria-valuenow", String(v));
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
        this._setHBar(index, (event.clientX - rect.left) / rect.width * 100);
      };
      bar.addEventListener("pointerdown", (event) => {
        const playing = Boolean(this._vsyncTimer && this._vscript);
        if (!this._vrec && !playing) {
          this._toast("Press ● Rec first to record with the slider (or play a script to take it over)");
          return;
        }
        event.preventDefault();
        active = true;
        if (!this._vrec) this._hbActive = true;
        bar.classList.add("active");
        capture(bar, event);
        fromEvent(event);
      });
      bar.addEventListener("pointermove", (event) => {
        if (active) fromEvent(event);
      });
      const release = () => {
        if (!active) return;
        active = false;
        bar.classList.remove("active");
        if (this._hbActive) {
          this._hbActive = false;
          this._videoSend(true);
          return;
        }
        if (this._el("vspring").checked) this._setHBar(index, 0);
      };
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) bar.addEventListener(type, release);
      bar.addEventListener("contextmenu", (event) => event.preventDefault());
      bar.addEventListener("keydown", (event) => {
        if (!this._vrec) return;
        const steps = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 20, PageDown: -20 };
        if (event.key in steps) {
          this._setHBar(index, this._hvals[index] + steps[event.key]);
          event.preventDefault();
        } else if (event.key === "Home") {
          this._setHBar(index, 0);
          event.preventDefault();
        } else if (event.key === "End") {
          this._setHBar(index, 100);
          event.preventDefault();
        }
      });
    }
    _vrecToggle() {
      const $ = this._el;
      if (!this._vurl) {
        this._toast("Choose a video first");
        return;
      }
      this._vrec = !this._vrec;
      if (!this._vrec) this._vrecBreak();
      this._vcur = null;
      $("vrec").classList.toggle("on", this._vrec);
      $("vrec").textContent = this._vrec ? "■ Stop rec" : "● Rec";
      for (const id of ["hb1", "hb2"]) $(id).classList.toggle("rec", this._vrec);
      if (this._vrec) {
        this._setHBar(0, 0);
        this._setHBar(1, 0);
        this._toast("Recording: play the video and drag the bars.");
        if (!$("video").paused) {
          this._videoHalt();
          this._videoRun();
        }
      } else {
        this._toast(this._vrecHas() ? "Recording stopped. Use it as a take, download it, or press ● Rec to add more." : "");
        const video = $("video");
        if (!video.paused) {
          clearInterval(this._vsyncTimer);
          this._vsyncTimer = null;
          this._videoRun();
        }
      }
      this._videoStatus();
    }
    // Sample the bars at the video's own time (only while it plays).
    _vrecSample() {
      const video = this._el("video");
      if (!this._vrec || video.paused || video.seeking) return;
      const at = Math.round(video.currentTime * 1e3);
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
    _vrecHas() {
      return this._vpasses[0].some((p) => p.length) || this._vpasses[1].some((p) => p.length);
    }
    _vrecScript() {
      this._vrecBreak();
      const main = mergePasses(this._vpasses[0]);
      if (!main.length) return null;
      const end = main[main.length - 1].at;
      const stroke = this._strokeKindRec;
      if (!stroke && main[main.length - 1].pos !== 0) main.push({ at: end + 1, pos: 0 });
      const script = {
        version: "1.0",
        inverted: false,
        range: 100,
        actions: main,
        metadata: { creator: "OggStudio", type: stroke ? "stroke" : "vibration", ...this._vname ? { title: this._vname } : {} }
      };
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
      $("vrecdone").hidden = this._vrec || !has;
      const merged = has ? mergePasses([...this._vpasses[0], ...this._vcur ? [this._vcur[0]] : []]) : [];
      const passes = this._vpasses[0].filter((p) => p.length).length + (this._vcur && this._vcur[0].length ? 1 : 0);
      $("vrecinfo").textContent = has ? `${fmt(merged.length ? merged[merged.length - 1].at - merged[0].at : 0)} recorded${passes > 1 ? ` · ${passes} passes` : ""}` : this._vrec ? "Play the video to record" : "";
    }
    _vrecUse() {
      const script = this._vrecScript();
      if (!script) return;
      this._take = script;
      this._vraw = script;
      this._vscript = script;
      this._vconvs = {};
      this._el("name").value = this._vname || "";
      this._vrecReset();
      this._toast(`Recorded ${fmt(duration(script))}. It is now the current take (save it below) and plays with this video.`);
      this._update();
    }
    _vrecDownload() {
      const script = this._vrecScript();
      if (script) this._download(script, this._vname || "oggstudio");
    }
    _vrecReset() {
      this._vpasses = [[], []];
      this._vcur = null;
      this._videoStatus();
    }
    async _videoGo() {
      const $ = this._el;
      const video = $("video");
      if (!this._vurl) {
        this._toast("Choose a video first");
        return;
      }
      if (!this._vscript && !this._vrec) {
        this._toast("Choose a script first, or press ● Rec to make one");
        return;
      }
      try {
        if (video.ended) video.currentTime = 0;
        await video.play();
      } catch (e) {
        this._toast("The browser would not start the video: " + (e.message || e));
      }
    }
    _videoStatus(levels) {
      if (!this._el) return;
      const $ = this._el;
      const video = $("video");
      $("hb2").hidden = true;
      const lab = this._strokeKindRec ? "Position" : "Intensity";
      const labEl = $("hb1").querySelector(".lab");
      if (labEl.textContent !== lab) labEl.textContent = lab;
      if (levels && !this._vrec && !this._hbActive && !this._outsHere && !(this._vsyncTimer && this._vscript)) this._showHBar(0, (levels[0] || 0) * 100);
      const parts = [];
      if (this._cast) {
        const c = this._cast;
        const tv = this._castName(c.entity);
        const st = this._hass && this._hass.states[c.entity];
        const mb = c.sent ? ` · streamed ${Math.round(c.sent / 1048576)} MB` : "";
        parts.push(c.phase === "starting" ? `📺 starting on ${tv}…${mb}` : `📺 ${tv}: ${st ? st.state : "?"}${mb}`);
      }
      if (this._vscript) parts.push(`Script ${fmt(duration(this._vscript))}`);
      if (this._vurl && Number.isFinite(video.duration)) parts.push(`video ${fmt(video.duration * 1e3)}`);
      if (this._vsyncTimer && levels) parts.push(`now ${levels.map((v) => Math.round(v * 100) + "%").join(" / ")}`);
      else if (this._vurl && this._vscript) parts.push("ready");
      $("vstat").textContent = parts.join(" · ");
      $("vgo").disabled = !(this._vurl && (this._vscript || this._vrec));
      this._vrecInfo();
    }
    get _noDevice() {
      return this._deviceId === NO_DEVICE;
    }
    get _device() {
      return this._noDevice ? null : this._devices.find((d) => d.id === this._deviceId) || this._devices[0] || null;
    }
    // Remember the chosen device per Home Assistant user (follows you across
    // phones), with a per-browser fallback when user data is unavailable.
    _rememberDevice(dev) {
      if (!dev) return;
      const value = { id: dev.id, name: dev.name };
      try {
        localStorage.setItem(DEVICE_KEY, JSON.stringify(value));
      } catch (_) {
      }
      this._remembered = value;
      this._hass?.callWS({ type: "frontend/set_user_data", key: DEVICE_KEY, value }).catch(() => {
      });
    }
    async _loadRemembered() {
      try {
        this._remembered = JSON.parse(localStorage.getItem(DEVICE_KEY) || "null");
      } catch (_) {
        this._remembered = null;
      }
      try {
        const res = await this._hass.callWS({ type: "frontend/get_user_data", key: DEVICE_KEY });
        if (res && res.value && res.value.id) this._remembered = res.value;
      } catch (_) {
      }
      this._rememberedLoaded = true;
      this._update();
    }
    _online(dev) {
      return Boolean(dev) && (!dev.connected || this._hass.states[dev.connected]?.state === "on");
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
      return this._registryDone ? NO_DEVICE : void 0;
    }
    _update() {
      if (!this._el || !this._hass) return;
      const $ = this._el;
      this._safetyUpdate();
      this._toolsUpdate();
      this._fillVideoScripts();
      const sel = $("device");
      const key = JSON.stringify([this._rememberedLoaded, ...this._devices.map((d) => [d.id, d.name, this._online(d)])]);
      if (sel.dataset.key !== key) {
        const ordered = [...this._devices].sort((a, b) => Number(this._online(b)) - Number(this._online(a)) || a.name.localeCompare(b.name));
        sel.replaceChildren(
          ...ordered.map((d) => new Option(this._online(d) ? d.name : `${d.name} (offline)`, d.id)),
          new Option("No device (record only)", NO_DEVICE)
        );
        sel.dataset.key = key;
        if (this._rememberedLoaded) this._deviceId = this._pickDevice();
      }
      if (this._deviceId) sel.value = this._deviceId;
      const dev = this._device;
      const online = dev && (!dev.connected || this._hass.states[dev.connected]?.state === "on");
      $("takeplay").disabled = !this._take;
      for (const [stop, d] of this._claimed) {
        const c = this._claimedBy(d);
        if (c) {
          this._claimed.delete(stop);
          this._toast(`${c.label || "Another controller"} took control of ${d.name}.`);
        }
      }
      this._outRender();
      $("rec").textContent = this._recording ? "■ Stop recording" : "● Record";
      $("rec").classList.toggle("on", this._recording);
      $("takebox").hidden = !this._take;
      if (this._take) {
        const kind = isStroke(this._take) ? "stroke script" : `${this._take.channels ? 2 : 1} motor${this._take.channels ? "s" : ""}`;
        $("takeinfo").textContent = `${fmt(duration(this._take))} · ${kind} · ${this._take.actions.length} points · not saved`;
      }
      $("takemodebox").hidden = true;
      const saved = this._studio && this._hass.states[this._studio.saved];
      const opts = saved && saved.attributes.options || [];
      const savedKey = JSON.stringify(opts);
      if ($("saved").dataset.key !== savedKey) {
        $("saved").replaceChildren(...opts.map((o) => new Option(o, o)));
        $("saved").dataset.key = savedKey;
      }
      if (saved && this.shadowRoot.activeElement !== $("saved")) $("saved").value = saved.state;
      const hasSaved = saved && saved.attributes.scripts && Object.keys(saved.attributes.scripts).length > 0;
      for (const id of ["code", "delete"]) $(id).disabled = !hasSaved;
      $("play").disabled = !hasSaved;
      const info = this._scriptInfo($("saved").value);
      $("libmodebox").hidden = true;
      const modeKey = `${$("saved").value}|${info && info.mode}`;
      if (info && info.kind === "stroke" && $("libmode").dataset.key !== modeKey && this.shadowRoot.activeElement !== $("libmode")) {
        $("libmode").value = info.mode || RUN_MODE_DEFAULT;
        $("libmode").dataset.key = modeKey;
      }
      this._stShow();
      if (!$("speed").options.length) $("speed").replaceChildren(...SPEEDS.map((s) => new Option(s, s)));
      const speed = this._studio && this._hass.states[this._studio.speed];
      if (speed && this.shadowRoot.activeElement !== $("speed")) $("speed").value = speed.state;
    }
    _setPad(index, value) {
      const pad = this._el("pad" + (index + 1));
      const v = Math.round(Math.min(100, Math.max(0, value)));
      this._vals[index] = v;
      pad.querySelector(".fill").style.height = v + "%";
      pad.querySelector(".pct").textContent = v + "%";
      pad.setAttribute("aria-valuenow", String(v));
    }
    _bindPad(pad, index) {
      let active = false;
      const fromEvent = (event) => {
        const rect = pad.getBoundingClientRect();
        this._setPad(index, (1 - (event.clientY - rect.top) / rect.height) * 100);
      };
      this._padActive = this._padActive || [false, false];
      pad.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        active = true;
        this._padActive[index] = true;
        pad.classList.add("active");
        capture(pad, event);
        fromEvent(event);
      });
      pad.addEventListener("pointermove", (event) => {
        if (active) fromEvent(event);
      });
      const release = () => {
        if (!active) return;
        active = false;
        this._padActive[index] = false;
        pad.classList.remove("active");
        if (this._el("spring").checked && !(this._rp && this._rp.playing)) this._setPad(index, 0);
      };
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) pad.addEventListener(type, release);
      pad.addEventListener("contextmenu", (event) => event.preventDefault());
      pad.addEventListener("keydown", (event) => {
        const steps = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 20, PageDown: -20 };
        if (event.key in steps) {
          this._setPad(index, this._vals[index] + steps[event.key]);
          event.preventDefault();
        } else if (event.key === "Home") {
          this._setPad(index, 0);
          event.preventDefault();
        } else if (event.key === "End") {
          this._setPad(index, 100);
          event.preventDefault();
        }
      });
    }
    // Pads: one, or two when a second output is chosen (one track each).
    get _twoPads() {
      return Boolean(this._outs) && this._outTargetValue(1) !== "off";
    }
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
  };

  // frontend/src/card/cast.js
  var CastPart = class {
    // Casting. A TV fetches what it plays, so a video that only exists in this
    // browser cannot be cast directly (Chrome's own cast refuses it, and the
    // Home Assistant app has no cast at all). Instead Home Assistant relays it,
    // in memory only: the TV's media player (Google Cast, DLNA, ...) is given a
    // private link, and each part of the video the TV asks for is read from the
    // local file here and passed on. Nothing is stored; the link ends with the
    // cast. The video here stays the clock: muted, it follows where the
    // TV says it is, and the devices sync to it as usual. Play, pause and seek
    // here are sent to the TV; pausing on the TV pauses here too.
    _bindCast() {
      const $ = this._el;
      $("vcast").addEventListener("click", () => this._castPicker($("castpop").hidden));
      this.shadowRoot.addEventListener("pointerdown", (e) => {
        if ($("castpop").hidden) return;
        const path = e.composedPath();
        if (!path.includes($("castpop")) && !path.includes($("vcast"))) this._castPicker(false);
      });
      this._castShow();
    }
    _castTargets() {
      const plat = this._mpPlatform || {};
      const states = this._hass && this._hass.states || {};
      return Object.entries(states).map(([id, st]) => ({ ...st, entity_id: id })).filter((st) => st.entity_id.startsWith("media_player.") && CAST_PLATFORMS.includes(plat[st.entity_id]) && st.state !== "unavailable" && (st.attributes.supported_features || 0) & 512).sort((x, y) => CAST_PLATFORMS.indexOf(plat[x.entity_id]) - CAST_PLATFORMS.indexOf(plat[y.entity_id]) || String(x.attributes.friendly_name || x.entity_id).localeCompare(String(y.attributes.friendly_name || y.entity_id)));
    }
    _castName(entity) {
      const st = this._hass && this._hass.states[entity];
      return st && st.attributes.friendly_name || entity;
    }
    _castPicker(open) {
      const $ = this._el;
      if (!open) {
        $("castpop").hidden = true;
        return;
      }
      if (!this._vurl) {
        this._toast("Choose a video first");
        return;
      }
      const item = (label, tag, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.innerHTML = `<span>${esc(label)}</span><small>${esc(tag)}</small>`;
        b.addEventListener("click", fn);
        return b;
      };
      const items = [];
      if (this._cast) items.push(item(`■ Stop casting to ${this._castName(this._cast.entity)}`, "", () => {
        this._castPicker(false);
        this._castEnd(true);
      }));
      const plat = this._mpPlatform || {};
      for (const st of this._castTargets()) {
        if (this._cast && this._cast.entity === st.entity_id) continue;
        const kind = { cast: "Cast", dlna_dmr: "DLNA", kodi: "Kodi", apple_tv: "Apple TV" }[plat[st.entity_id]] || "";
        items.push(item(st.attributes.friendly_name || st.entity_id, `${kind} · ${st.state}`, () => this._castStart(st.entity_id)));
      }
      if (!items.length) {
        const d = document.createElement("div");
        d.className = "hint";
        d.textContent = "No TV found: add your Chromecast or TV to Home Assistant (the Google Cast or DLNA integration) and it shows here.";
        items.push(d);
      }
      $("castlist").replaceChildren(...items);
      $("castpop").hidden = false;
    }
    // Open the relay: Home Assistant asks for blocks of the file, this answers them.
    async _castRelay(file, cast) {
      let ready;
      const link = new Promise((ok, fail) => {
        ready = ok;
        setTimeout(() => fail(new Error("Home Assistant did not open the link (update OggStudio?)")), 1e4);
      });
      const answer = async (req, start, length) => {
        try {
          const body = await file.slice(start, start + length).arrayBuffer();
          if (this._cast !== cast) return;
          const r = await this._hass.fetchWithAuth(`/api/oggstudio/relay_data/${cast.relay}/${req}`, { method: "POST", body });
          if (r.ok) {
            cast.sent = (cast.sent || 0) + length;
            this._castShowSoon();
          }
        } catch (_) {
        }
      };
      cast.unsub = await this._hass.connection.subscribeMessage((m) => {
        if (m.ready) {
          cast.relay = m.id;
          ready(m.url);
        } else if (m.req !== void 0) answer(m.req, m.start, m.length);
      }, { type: "oggstudio/relay", name: file.name, size: file.size, mime: file.type || "video/mp4" }, { resubscribe: false });
      if (this._cast !== cast) {
        cast.unsub();
        throw new Error("cancelled");
      }
      return link;
    }
    _castShowSoon() {
      if (this._castShowTimer) return;
      this._castShowTimer = setTimeout(() => {
        this._castShowTimer = null;
        this._castShow();
      }, 500);
    }
    // Keep the screen on while casting: the video streams from this device.
    async _castWake(on) {
      try {
        if (!on) {
          if (this._wake) await this._wake.release();
          this._wake = null;
          return;
        }
        if (navigator.wakeLock && !this._wake && document.visibilityState === "visible") {
          this._wake = await navigator.wakeLock.request("screen");
          this._wake.addEventListener("release", () => {
            this._wake = null;
          });
        }
      } catch (_) {
      }
      if (!this._wakeBound) {
        this._wakeBound = true;
        document.addEventListener("visibilitychange", () => {
          if (this._cast) this._castWake(true);
        });
      }
    }
    async _castStart(entity) {
      this._castPicker(false);
      const file = this._vfileObj;
      if (!file) {
        this._toast("Choose a video first");
        return;
      }
      if (this._cast) this._castEnd(this._cast.entity !== entity);
      const video = this._el("video");
      const cast = { entity, phase: "starting", startAt: video.currentTime || 0, since: performance.now() };
      this._cast = cast;
      this._castShow();
      try {
        const url = await this._castRelay(file, cast);
        if (this._cast !== cast) return;
        cast.file = cast.relay;
        cast.since = performance.now();
        this._castWake(true);
        this._castWasMuted = video.muted;
        video.muted = true;
        this._castQuiet("pause");
        await this._hass.callService("media_player", "play_media", {
          entity_id: entity,
          media_content_id: url,
          media_content_type: file.type || "video/mp4"
        });
        if (!this._castTimer) this._castTimer = setInterval(() => this._castSync(), 250);
      } catch (e) {
        if (this._cast !== cast) return;
        this._castEnd(false, cast.cancelled ? void 0 : "Could not cast: " + (e && e.message || e));
      }
    }
    // Stop casting (and the TV, if asked). The link to the video ends here.
    _castEnd(stopTv, message) {
      const cast = this._cast;
      if (!cast) return;
      cast.cancelled = true;
      this._cast = null;
      clearInterval(this._castTimer);
      this._castTimer = null;
      if (cast.unsub) {
        try {
          cast.unsub();
        } catch (_) {
        }
      }
      this._castWake(false);
      const video = this._el && this._el("video");
      if (video && this._castWasMuted !== void 0) {
        video.muted = this._castWasMuted;
        this._castWasMuted = void 0;
      }
      if (stopTv && cast.relay && this._hass) this._hass.callService("media_player", "media_stop", { entity_id: cast.entity }, void 0, false).catch(() => {
      });
      this._toast(message || "Casting stopped.");
      this._castShow();
    }
    // Change the video here without it being sent back to the TV: the event
    // each change causes (play, pause, seeked) is expected and skipped once.
    _castQuiet(kind) {
      const cast = this._cast;
      const video = this._el("video");
      if (kind === "play" ? !video.paused : kind === "pause" ? video.paused : false) return;
      const key = typeof kind === "string" ? kind : "seek";
      if (cast) {
        cast.expect = cast.expect || {};
        cast.expect[key] = { n: (cast.expect[key] && cast.expect[key].n || 0) + 1, until: performance.now() + 2e3 };
      }
      try {
        const r = kind === "play" ? video.play() : kind === "pause" ? video.pause() : video.currentTime = kind.seek;
        if (r && r.catch) r.catch(() => {
        });
      } catch (_) {
      }
    }
    _castExpected(kind) {
      const e = this._cast && this._cast.expect && this._cast.expect[kind];
      if (!e || !e.n || performance.now() > e.until) return false;
      e.n -= 1;
      return true;
    }
    // Play, pause or seek here: tell the TV.
    _castCmd(service, data) {
      const cast = this._cast;
      if (!cast) return;
      if (this._castExpected(service === "media_play" ? "play" : service === "media_pause" ? "pause" : "seek") || cast.phase !== "on") return;
      cast.cmdUntil = performance.now() + CAST_GRACE;
      if (service === "media_seek") cast.pos = null;
      this._hass.callService("media_player", service, { entity_id: cast.entity, ...data || {} }, void 0, false).catch((e) => this._toast("The TV did not take that: " + (e && e.message || e)));
    }
    // Where the TV is now, from what Home Assistant last heard from it.
    _castTvPos(st) {
      const cast = this._cast;
      const a = st.attributes;
      if (!Number.isFinite(a.media_position)) return null;
      if (a.media_position_updated_at !== cast.stamp) {
        cast.fresh = cast.stamp !== void 0;
        cast.stamp = a.media_position_updated_at;
        cast.seenAt = Date.now();
      }
      if (st.state !== "playing") return a.media_position;
      const since = cast.fresh ? Date.now() - cast.seenAt : Math.max(0, Date.now() - Date.parse(a.media_position_updated_at));
      return a.media_position + (Number.isFinite(since) ? since : 0) / 1e3;
    }
    _castSync() {
      const cast = this._cast;
      if (!cast || !cast.relay || !this._el) return;
      const st = this._hass.states[cast.entity];
      const video = this._el("video");
      if (!st) return;
      const now = performance.now();
      const ours = cast.file && String(st.attributes.media_content_id || "").includes(cast.file);
      if (cast.phase === "starting") {
        if (ours && (st.state === "playing" || st.state === "paused")) {
          cast.phase = "on";
          cast.lostAt = 0;
          this._toast(`Casting to ${this._castName(cast.entity)}. The devices follow the TV.`);
          if (cast.startAt > 1) {
            this._hass.callService("media_player", "media_seek", { entity_id: cast.entity, seek_position: Math.round(cast.startAt * 10) / 10 }, void 0, false).catch(() => {
            });
            cast.cmdUntil = now + CAST_GRACE;
            this._castQuiet({ seek: cast.startAt });
          }
          this._castQuiet("play");
          this._castShow();
        } else if (now - cast.since > 3e4) {
          this._castEnd(false, `${this._castName(cast.entity)} did not start the video. Chromecasts play MP4 (H.264) and WebM; check Home Assistant can reach the TV.`);
        }
        return;
      }
      if (!ours || ["off", "idle", "standby", "unavailable"].includes(st.state)) {
        if (!cast.lostAt) cast.lostAt = now;
        if (now - cast.lostAt > 4e3) {
          this._castQuiet("pause");
          this._castEnd(false, `${this._castName(cast.entity)} stopped playing the video.`);
        }
        return;
      }
      cast.lostAt = 0;
      if (now < (cast.cmdUntil || 0)) {
        this._castShow();
        return;
      }
      const pos = this._castTvPos(st);
      const playing = st.state === "playing";
      if (playing && video.paused && !video.ended) this._castQuiet("play");
      if (!playing && !video.paused) this._castQuiet("pause");
      if (pos !== null && Number.isFinite(video.duration) && Math.abs(video.currentTime - pos) > CAST_DRIFT && pos < video.duration) {
        this._castQuiet({ seek: pos });
      }
      this._castShow();
    }
    _castShow() {
      if (!this._el) return;
      const btn = this._el("vcast");
      const cast = this._cast;
      const text = !cast ? "📺 Cast" : cast.phase === "starting" ? "📺 …" : "📺 On TV";
      if (btn.textContent !== text) btn.textContent = text;
      btn.classList.toggle("on", Boolean(cast && cast.phase === "on"));
      this._videoStatus();
    }
  };

  // frontend/src/card/replay.js
  var ReplayPart = class {
    // ---------------------------------------------------------- record / replay
    // Replay runs here in the browser: the script moves the pads or the
    // stroke bar, every device that follows gets it its own way, and it works
    // with no device at all. Touching the pads or bar overrides it until let go.
    _bindReplay() {
      const $ = this._el;
      this._rp = { raw: null, conv: null, name: "", lib: null, playing: false, t: 0, len: 0, last: 0, outAt: 0 };
      let ctl = null;
      try {
        ctl = localStorage.getItem(`oggstudio_ctl:${this.localName}`);
      } catch (_) {
      }
      this._ctl = ["replay", "mood", "audio", "together"].includes(ctl) ? ctl : "record";
      for (const b of this.shadowRoot.querySelectorAll(".ctltabs button")) b.addEventListener("click", () => this._setCtl(b.dataset.ctl));
      $("rpspeed").replaceChildren(...SPEEDS.map((x) => new Option(x, x)));
      $("rpspeed").value = "1x";
      $("rppick").addEventListener("click", () => this._rpPicker(!$("rppop").hidden ? false : true));
      $("rpfile").addEventListener("change", () => this._rpFromFiles());
      $("rpplay").addEventListener("click", () => this._rpToggle());
      for (const b of this.shadowRoot.querySelectorAll(".moodbtn")) b.addEventListener("click", () => this._moodPlay(b.dataset.mood));
      $("moodnext").addEventListener("click", () => {
        if (this._mood) this._moodNext(!this._rp.playing);
      });
      $("moodstop").addEventListener("click", () => {
        this._plOff();
        this._rpStop();
      });
      let strength = 100;
      try {
        strength = Number(localStorage.getItem("oggstudio_mood_strength")) || 100;
      } catch (_) {
      }
      $("moodstr").value = String(strength);
      const showStrength = () => {
        $("moodstrv").textContent = `${$("moodstr").value}%`;
      };
      showStrength();
      $("moodstr").addEventListener("input", showStrength);
      $("moodstr").addEventListener("change", () => {
        try {
          localStorage.setItem("oggstudio_mood_strength", $("moodstr").value);
        } catch (_) {
        }
      });
      const bar = $("rpbar");
      const seek = (e) => {
        const r = bar.getBoundingClientRect();
        this._rp.t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * this._rp.len;
        this._rpShow();
        if (this._rp.playing) this._rpTick();
      };
      bar.addEventListener("pointerdown", (e) => {
        if (!this._rp.raw) return;
        e.preventDefault();
        capture(bar, e);
        seek(e);
        bar.dataset.drag = "1";
      });
      bar.addEventListener("pointermove", (e) => {
        if (bar.dataset.drag) seek(e);
      });
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) bar.addEventListener(type, () => {
        delete bar.dataset.drag;
      });
      this.shadowRoot.addEventListener("pointerdown", (e) => {
        if ($("rppop").hidden) return;
        const path = e.composedPath();
        if (!path.includes($("rppop")) && !path.includes($("rppick"))) this._rpPicker(false);
      });
      this._ctlShow();
      this._rpShow();
    }
    _setCtl(mode) {
      if (mode === this._ctl) return;
      if (this._ctl === "record") {
        if (this._recording) this._stopRecording();
        if (this._stRecording) this._stStop();
        if (this._live) {
          this._el("live").checked = false;
          this._setLive(false);
        }
        if (this._el("stlive").checked) {
          this._el("stlive").checked = false;
          this._stRun();
        }
      } else {
        this._plOff();
        this._rpStop();
        this._auStop();
      }
      if (mode !== "mood") this._mood = null;
      this._ctl = mode;
      try {
        localStorage.setItem(`oggstudio_ctl:${this.localName}`, mode);
      } catch (_) {
      }
      this._ctlShow();
    }
    _ctlShow() {
      const $ = this._el;
      const replay = this._ctl === "replay";
      for (const b of this.shadowRoot.querySelectorAll(".ctltabs button")) b.classList.toggle("on", b.dataset.ctl === this._ctl);
      $("rpbox").hidden = !replay;
      $("moodbox").hidden = this._ctl !== "mood";
      $("aubox").hidden = this._ctl !== "audio";
      $("tgbox").hidden = this._ctl !== "together";
      this._outRender();
      for (const id of ["rec", "timer", "strec", "liverow", "stliverow"]) $(id).hidden = this._ctl !== "record";
      this._rpShow();
    }
    _rpPicker(open) {
      const $ = this._el;
      if (!open) {
        $("rppop").hidden = true;
        return;
      }
      const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
      const names = (saved && saved.attributes.options || []).filter((n) => n && !/^\(.*\)$/.test(n));
      const item = (label, tag, fn, heat) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.heat = heat;
        b.innerHTML = `<span>${esc(label)}</span><small>${esc(tag)}</small>`;
        b.addEventListener("click", () => {
          this._plOff();
          fn();
        });
        return b;
      };
      const items = [];
      if (this._take) items.push(item("Current take", `${isStroke(this._take) ? "stroke" : "vibration"} · ${fmt(duration(this._take))}`, () => this._rpLoad(this._take, "Current take", null), "\0take"));
      for (const n of names) {
        const info = this._scriptInfo(n);
        items.push(item(n, info ? `${info.kind === "stroke" ? "stroke" : "vibration"} · ${fmt(info.duration_ms || 0)}` : "", async () => {
          try {
            this._rpLoad(await this._getSaved(n), n, n);
          } catch (e) {
            this._toast("Could not load the script: " + (e.message || e));
          }
        }, n));
      }
      if (!items.length) {
        const d = document.createElement("div");
        d.className = "hint";
        d.textContent = "No saved scripts yet: record one, or load a file below.";
        items.push(d);
      }
      $("rplist").replaceChildren(...items);
      $("rppop").hidden = false;
      this._pickHeats();
    }
    async _rpFromFiles() {
      const files = [...this._el("rpfile").files];
      if (!files.length) return;
      try {
        const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
        const first = parsed[0];
        if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
        this._plOff();
        this._rpLoad(normalise(first, fileKind(files[0].name, "auto"), Boolean(first.inverted)), fileTitle(files[0].name), null);
      } catch (e) {
        this._toast("Could not read the file: " + (e.message || e));
      }
      this._el("rpfile").value = "";
    }
    _rpLoad(script, name, lib) {
      this._rpStop();
      const rp = this._rp;
      rp.raw = script;
      rp.name = name;
      rp.lib = lib;
      rp.t = 0;
      rp.len = duration(script);
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
      if (raw.mood) {
        const k = this._moodStrength();
        return [0, 1].map((i) => {
          const p = parseTarget(this._outTargetValue(i));
          this._aiLabel(i, null);
          if (p && p.motor === "l") return moodSoften(sampleAt(raw.actions, ms), k, ms);
          return sampleAt(raw.mood.vibe[i] || raw.mood.vibe[0], ms) * k;
        });
      }
      return [0, 1].map((i) => {
        const v1 = i && raw.channels && raw.channels.V1 && raw.channels.V1.actions;
        const second = Boolean(v1 && v1.length);
        const track = second ? v1 : raw.actions;
        const p = parseTarget(this._outTargetValue(i));
        const m = this._outs[i].m;
        if (m === FOLLOW_AI) {
          const linear = Boolean(p && p.motor === "l");
          if (linear === isStroke(raw)) {
            this._aiLabel(i, null);
            return sampleAt(track, ms);
          }
          const key2 = `ai:${second ? 1 : 0}:${linear ? "s" : "v"}`;
          if (!cache[key2]) cache[key2] = linear ? aiVibeToStroke(track) : aiStrokeToVibe(track);
          this._aiLabel(i, moodAt(cache[key2].moods, ms));
          return sampleAt(cache[key2].actions, ms);
        }
        this._aiLabel(i, null);
        if (m === FOLLOW_STROKER || m === "position" || p && p.motor === "l") return sampleAt(track, ms);
        const key = `${second ? 1 : 0}:${m}`;
        if (!cache[key]) cache[key] = toIntensity(track, m);
        return sampleAt(cache[key], ms);
      });
    }
    // A stroker's next move from a script at ms: its next action (or, with AI
    // feel on a vibration script, the next planned stroke) and how long to take.
    _moodStrength() {
      return Number(this._el("moodstr").value || 100) / 100;
    }
    _goalFrom(i, raw, ms, rate, cache) {
      if (raw.mood) {
        const next2 = nextAction(raw.actions, ms);
        return next2 ? { goal: moodSoften(next2.pos, this._moodStrength(), next2.at), dur: (next2.at - ms) / (rate || 1) } : null;
      }
      const v1 = i && raw.channels && raw.channels.V1 && raw.channels.V1.actions;
      const second = Boolean(v1 && v1.length);
      let src = second ? v1 : raw.actions;
      if (this._outs[i].m === FOLLOW_AI && !isStroke(raw)) {
        const key = `ai:${second ? 1 : 0}:s`;
        if (!cache[key]) cache[key] = aiVibeToStroke(src);
        src = cache[key].actions;
        this._aiLabel(i, moodAt(cache[key].moods, ms));
      }
      const next = nextAction(src, ms);
      return next ? { goal: next.pos, dur: (next.at - ms) / (rate || 1) } : null;
    }
    // Live AI feel per output (one engine each, restarted when stopped).
    _aiLiveFor(i, kind) {
      this._aiLive = this._aiLive || [null, null];
      if (!this._aiLive[i] || this._aiLive[i].kind !== kind) this._aiLive[i] = new AiLive(kind);
      return this._aiLive[i];
    }
    // Stroke in -> vibration level by feel (stroke recorder, stroke video slider).
    _aiStroke(i, pos, vel) {
      const eng = this._aiLiveFor(i, "stroke");
      const v = eng.level(performance.now(), pos, Math.sign(vel));
      this._aiLabel(i, eng.label);
      return v;
    }
    // What each output's AI feel is doing now, shown under it.
    _aiLabel(i, label) {
      this._aiLabels = this._aiLabels || [null, null];
      this._aiLabels[i] = label;
      const now = performance.now();
      if (now - (this._aiShownAt || 0) < 250 || !this._el) return;
      this._aiShownAt = now;
      [...this.shadowRoot.querySelectorAll(".outai")].forEach((el, j) => {
        const l = this._outs[j].m === FOLLOW_AI ? this._aiLabels[j] : null;
        el.hidden = !l;
        if (l && el.textContent !== `✨ ${l}`) el.textContent = `✨ ${l}`;
      });
    }
    // A live value (pad, slider) mapped by an output's way of following.
    _mapLive(i, value, vel) {
      const p = parseTarget(this._outTargetValue(i));
      const m = this._outs[i].m;
      if (p && p.motor === "l" && m === FOLLOW_AI) {
        const eng = this._aiLiveFor(i, "vibe");
        const move = eng.move(performance.now(), value);
        this._aiLabel(i, eng.label);
        return move;
      }
      if (m === FOLLOW_AI) {
        this._aiLabel(i, null);
        return value;
      }
      if (p && p.motor === "l") return { goal: value, dur: 150 };
      if (m === FOLLOW_STROKER || m === "position") return value;
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
        this._padVel[i] = this._padVel[i] * 0.6 + (dt > 0 ? (v - prev.v) / dt * 1e3 : 0) * 0.4;
        this._padPrev[i] = { v, at: now };
        return this._mapLive(i, v, this._padVel[i]);
      });
      this._outApply(out, 1);
    }
    // A saved stroke script's remembered run mode becomes the first device's follow type.
    _useRemembered(lib, script) {
      const info = lib && this._scriptInfo(lib);
      const p = parseTarget(this._outTargetValue(0));
      if (info && info.mode && RUN_MODES[info.mode] && isStroke(script) && p && p.motor !== "l") {
        this._outs[0].m = info.mode;
        this._outSave();
      }
    }
    // The script converted with one run mode (cached per mode).
    _rpConv(mode) {
      const rp = this._rp;
      rp.convs = rp.convs || {};
      if (!rp.convs[mode]) rp.convs[mode] = runScript(rp.raw, mode);
      return rp.convs[mode];
    }
    _rpToggle() {
      if (this._rp.playing) {
        this._plOff();
        this._rpStop();
      } else this._rpPlay();
    }
    // A mood: one of its three combos at random (a different one each time).
    _moodPlay(key) {
      if (this._mood && this._mood.key === key && this._rp.playing) {
        this._rpStop();
        return;
      }
      this._setCtl("mood");
      this._mood = { key, combo: -1 };
      this._moodNext(true);
    }
    _moodNext(start) {
      const mood = MOODS[this._mood.key];
      let i;
      do {
        i = Math.floor(Math.random() * mood.combos.length);
      } while (mood.combos.length > 1 && i === this._mood.combo);
      this._mood.combo = i;
      const [name, sections] = mood.combos[i];
      const built = buildMood(sections, aiRandom(Math.random() * 2 ** 32 >>> 0));
      const title = `${mood.label}: ${name}`;
      const script = {
        version: "1.0",
        inverted: false,
        range: 100,
        actions: built.stroke,
        metadata: { creator: "OggStudio", type: "stroke", title },
        mood: { vibe: built.vibe }
      };
      const rp = this._rp;
      if (!start && rp.playing) {
        rp.raw = script;
        rp.name = title;
        rp.len = duration(script);
        rp.t = 0;
        rp.convs = {};
        this._rpShow();
        return;
      }
      this._rpLoad(script, title, null);
      this._el("rpspeed").value = "1x";
      this._rpPlay();
    }
    _rpPlay() {
      const rp = this._rp;
      if (!rp.raw) {
        this._rpPicker(true);
        return;
      }
      if (rp.t >= rp.len) rp.t = 0;
      const video = this._el("video");
      if (video && !video.paused) video.pause();
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
      if (this._st) this._stRun();
      this._outRender();
      this._rpShow();
    }
    _rpSpeed() {
      return parseFloat(this._el("rpspeed").value) || 1;
    }
    // Raw position (stroke view) at the replay time.
    _rpPos() {
      const rp = this._rp;
      if (!rp.raw) return 0;
      const pos = sampleAt(rp.raw.actions, rp.t);
      return rp.raw.mood ? moodSoften(pos, this._moodStrength(), rp.t) : pos;
    }
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
      if (rp.t >= rp.len && this._pl && this._pl.on) {
        rp.t = rp.len;
        this._plNext();
        return;
      }
      if (rp.t >= rp.len && rp.raw.mood && this._mood) {
        this._moodNext(false);
        return;
      }
      if (rp.t >= rp.len) {
        if (this._el("rploop").checked && rp.len > 0) rp.t = 0;
        else {
          rp.t = rp.len;
          this._rpStop();
          this._toast(`Replay of "${rp.name}" finished.`);
          return;
        }
      }
      if (this._strokeKind) {
        this._stRun();
      } else if (rp.raw) {
        const targets = [0, 1].map((i) => parseTarget(this._outTargetValue(i)));
        const vals = this._mapScript(rp.raw, rp.t, rp.convs || (rp.convs = {}));
        for (const i of [0, 1]) if (!this._padActive || !this._padActive[i]) this._setPad(i, vals[i]);
        if (now - rp.outAt >= 100 || targets.some((t) => t && t.motor === "l")) {
          if (now - rp.outAt >= 100) rp.outAt = now;
          const out = [0, 1].map((i) => {
            if (i && !this._twoPads) return null;
            if (targets[i] && targets[i].motor === "l") return this._padActive && this._padActive[i] ? { goal: this._vals[i], dur: 150 } : this._goalFrom(i, rp.raw, rp.t, this._rpSpeed(), rp.convs) || { goal: this._vals[i], dur: 150 };
            return this._vals[i];
          });
          this._outApply(out, 0.6);
        }
      }
      if (now - (rp.shownAt || 0) >= 100) {
        rp.shownAt = now;
        this._rpShow();
      }
    }
    _rpShow() {
      if (!this._el || !this._rp) return;
      const $ = this._el;
      const rp = this._rp;
      $("rpname").textContent = rp.raw ? rp.name : "Choose a script…";
      this._heatShow();
      $("rpfill").style.width = rp.len ? `${Math.min(100, rp.t / rp.len * 100)}%` : "0";
      const kind = rp.raw ? isStroke(rp.raw) ? "stroke script" : "vibration script" : "";
      const parts = rp.raw ? [`${fmt(rp.t)} / ${fmt(rp.len)}`, kind] : ["Pick a saved script, the current take or a file"];
      if (rp.raw && !this._outs.some((o, i) => parseTarget(this._outTargetValue(i)))) parts.push("no device: showing only");
      if (rp.playing) parts.push(this._strokeKind ? "touch the bar or a speed to take over" : "touch a pad to take over");
      $("rpinfo").textContent = parts.join(" · ");
      $("rpplay").textContent = rp.playing ? "■ Stop" : "▶ Replay";
      const mood = this._mood && MOODS[this._mood.key];
      for (const b of this.shadowRoot.querySelectorAll(".moodbtn")) b.classList.toggle("on", Boolean(mood && rp.playing && b.dataset.mood === this._mood.key));
      $("moodfill").style.width = mood && rp.len ? `${Math.min(100, rp.t / rp.len * 100)}%` : "0";
      $("moodinfo").textContent = mood ? `${mood.icon} ${rp.name} (${this._mood.combo + 1} of ${mood.combos.length}) · ${fmt(rp.t)} / ${fmt(rp.len)}${rp.playing ? "" : " · stopped"}` : "Pick how you want it to feel. Each mood has three combos, picked at random; a new one follows when it ends.";
      $("rpplay").classList.toggle("stop", rp.playing);
    }
  };

  // frontend/src/lib/limits.js
  var NO_LIMITS = { max: 100, lo: 0, hi: 100, speed: 100 };
  var LIMIT_FULL_SPEED = 400;
  var limitsFor = (all, stop) => ({ ...NO_LIMITS, ...all && all[stop] || {} });
  var isLimited = (lim) => lim.max < 100 || lim.lo > 0 || lim.hi < 100 || lim.speed < 100;
  var limitLevels = (lim, levels) => levels.map((v) => Math.min(100, Math.max(0, v)) * lim.max / 100);
  function limitMove(lim, move, from) {
    const span = lim.hi - lim.lo;
    const goal = lim.lo + Math.min(100, Math.max(0, move.goal)) * span / 100;
    let dur = move.dur;
    if (lim.speed < 100) {
      const start = from === null || from === void 0 ? goal - lim.lo > span / 2 ? lim.lo : lim.hi : from;
      dur = Math.max(dur, Math.abs(goal - start) / (LIMIT_FULL_SPEED * lim.speed / 100) * 1e3);
    }
    return { goal, dur };
  }
  function limitsText(lim) {
    const bits = [];
    if (lim.max < 100) bits.push(`top ${lim.max}%`);
    if (lim.lo > 0 || lim.hi < 100) bits.push(`range ${lim.lo}-${lim.hi}%`);
    if (lim.speed < 100) bits.push(`speed ${lim.speed}%`);
    return bits.join(" · ");
  }

  // frontend/src/card/outputs.js
  var OutputsPart = class {
    // ---------------------------------------------------------- outputs
    _bindOutputs() {
      const $ = this._el;
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(OUT_KEY) || "null");
      } catch (_) {
      }
      const t = saved && Array.isArray(saved.t) ? saved.t : [];
      const m = saved && Array.isArray(saved.m) ? saved.m : [];
      this._outs = [0, 1].map((i) => ({ t: typeof t[i] === "string" ? t[i] : i ? "off" : null, m: typeof m[i] === "string" ? m[i] : "position" }));
      for (const row of this.shadowRoot.querySelectorAll(".outrow")) {
        const i = Number(row.dataset.row);
        row.querySelector(".outt").addEventListener("change", (e) => {
          this._outSwitch(i, { t: e.target.value });
        });
        row.querySelector(".outm").addEventListener("change", (e) => {
          this._outSwitch(i, { m: e.target.value });
        });
        row.querySelector(".outtake").addEventListener("click", () => this._outTake(i));
      }
      this._outRender();
    }
    _outSave() {
      try {
        localStorage.setItem(OUT_KEY, JSON.stringify({ t: this._outs.map((o) => o.t), m: this._outs.map((o) => o.m) }));
      } catch (_) {
      }
    }
    _outSwitch(i, change) {
      this._outStop();
      Object.assign(this._outs[i], change);
      this._outSave();
      this._outRender();
      this._update();
    }
    // The saved target if it still exists, else a sensible default.
    _outTargetValue(i) {
      const t = this._outs[i].t;
      if (t === "none" || t === "off") return t;
      const p = parseTarget(t);
      if (p && this._devices.some((d) => d.id === p.id)) return t;
      if (i === 1) return "off";
      if (!this._registryDone) return "none";
      const id = this._remembered && this._remembered.id;
      const dev = this._devices.find((d) => d.id === id) || this._devices.find((d) => this._online(d)) || this._devices[0];
      return dev ? `${dev.id}|${dev.linear && !dev.vibe ? "l" : "b"}` : "none";
    }
    _outDevice(i) {
      const p = parseTarget(this._outTargetValue(i));
      return p ? this._devices.find((d) => d.id === p.id) : null;
    }
    _controllers() {
      const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
      return saved && saved.attributes.controllers || {};
    }
    // Driven by another OggStudio card (another phone or browser) right now?
    _claimedBy(dev) {
      const c = dev && this._controllers()[dev.stop];
      if (!c || c.owner === this._owner) return null;
      if (this._tookAt && this._tookAt[dev.stop] && performance.now() - this._tookAt[dev.stop] < 3e3) return null;
      return c;
    }
    _outLabel() {
      const ua = navigator.userAgent;
      const where = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : "a browser";
      return `${this._hass && this._hass.user && this._hass.user.name || "Someone"} on ${where}`;
    }
    _outClaim(dev) {
      if (this._claimedBy(dev)) return false;
      const now = performance.now();
      this._claimed.set(dev.stop, dev);
      if (!(now - (this._claimAt[dev.stop] || -1e9) < 4e3)) {
        this._claimAt[dev.stop] = now;
        this._hass.callService("oggstudio", "claim", { entity_id: dev.stop, owner: this._owner, label: this._outLabel() }, void 0, false).catch(() => {
        });
      }
      return true;
    }
    _outTake(i) {
      const dev = this._outDevice(i);
      if (!dev) return;
      this._tookAt = this._tookAt || {};
      this._tookAt[dev.stop] = performance.now();
      this._claimAt[dev.stop] = performance.now();
      this._hass.callService("oggstudio", "claim", { entity_id: dev.stop, owner: this._owner, label: this._outLabel() }, void 0, false).catch(() => {
      });
      this._toast(`You now control ${dev.name}.`);
      this._outRender();
    }
    // Send output values (0-100; a stroker may get {goal, dur}) to the devices.
    _outApply(values, seconds) {
      if (!this._hass || !this._outs) return;
      const now = performance.now();
      if (now < (this._holdUntil || 0)) return;
      const targets = this._outs.map((o, i) => this._outTargetValue(i));
      let blocked = false;
      for (const e of outLevels(targets, values, this._devices)) {
        if (!this._outClaim(e.dev)) {
          blocked = true;
          continue;
        }
        if (e.vibe) {
          const lv = limitLevels(this._limits(e.dev), e.levels).map((x) => Math.round(x) / 100);
          const last = this._outLast[e.dev.id];
          if (!last || lv.some((x, j) => Math.abs(x - last.lv[j]) >= 0.01) || now - last.at > 500) {
            this._outLast[e.dev.id] = { lv, at: now };
            this._sendLive(e.dev, lv, seconds);
          }
        }
        if (e.linear !== null) this._outLinear(e.dev, typeof e.linear === "object" ? e.linear : { goal: e.linear, dur: 150 }, now);
      }
      if (blocked !== Boolean(this._outBlocked)) {
        this._outBlocked = blocked;
        this._outRender();
      }
    }
    // Strokers take "go to this position over this long" moves. Ogg's
    // ogg.linear does that live; without it, Ogg's Position control is used
    // (coarse: it moves over a fixed second).
    _outLinear(dev, asked, now) {
      const last = this._linLast[dev.id];
      const move = limitMove(this._limits(dev), asked, last ? last.goal : null);
      const goal = Math.round(Math.min(100, Math.max(0, move.goal)));
      if (last && last.goal === goal && now - last.at < 1e3) return;
      const live = Boolean(this._hass.services && this._hass.services.ogg && this._hass.services.ogg.linear);
      if (last && now - last.at < (live ? 80 : 400)) return;
      this._linLast[dev.id] = { goal, at: now };
      if (live) this._hass.callService("ogg", "linear", { entity_id: dev.stop, position: goal, duration: Math.max(50, Math.round(move.dur)) }, void 0, false).catch(() => {
      });
      else if (dev.linear) this._hass.callService("number", "set_value", { entity_id: dev.linear, value: goal }, void 0, false).catch(() => {
      });
    }
    // Stop and release every device this card was driving (not ones another
    // controller has since taken over).
    _outStop() {
      for (const [stop, dev] of this._claimed) {
        if (this._claimedBy(dev)) continue;
        this._quietStop(dev);
        if (this._hass) this._hass.callService("oggstudio", "claim", { entity_id: stop, owner: this._owner, release: true }, void 0, false).catch(() => {
        });
      }
      this._claimed.clear();
      this._claimAt = {};
      this._outLast = {};
      this._linLast = {};
      this._aiLive = [null, null];
    }
    _outRender() {
      if (!this._el || !this._outs) return;
      const stroke = this._strokeKind;
      const devs = [...this._devices].sort((a, b) => Number(this._online(b)) - Number(this._online(a)) || a.name.localeCompare(b.name));
      const opts = (i) => {
        const list = i ? [["off", stroke ? "— No second device —" : "— No second pad —"], ...stroke ? [] : [["none", "Second pad, no device"]]] : [["none", "No device (record only)"]];
        for (const d of devs) {
          const name = this._online(d) ? d.name : `${d.name} (offline)`;
          const vibe = d.vibe || !d.linear;
          if (vibe && !d.dual) list.push([`${d.id}|b`, name]);
          if (vibe && d.dual) list.push([`${d.id}|b`, `${name} · both motors`], [`${d.id}|0`, `${name} · motor 1`], [`${d.id}|1`, `${name} · motor 2`]);
          if (d.linear) list.push([`${d.id}|l`, `${name} · stroker`]);
        }
        return list;
      };
      const labels = [];
      for (const row of this.shadowRoot.querySelectorAll(".outrow")) {
        const i = Number(row.dataset.row);
        const sel = row.querySelector(".outt");
        const list = opts(i);
        const key = JSON.stringify([stroke, list]);
        if (sel.dataset.key !== key) {
          sel.replaceChildren(...list.map(([v, t]) => new Option(t, v)));
          sel.dataset.key = key;
        }
        const value = this._outTargetValue(i);
        if ([...sel.options].some((o) => o.value === value)) sel.value = value;
        const p = parseTarget(value);
        const dev = p && this._devices.find((d) => d.id === p.id);
        labels.push(dev ? p.motor === "b" ? dev.name : p.motor === "l" ? `${dev.name} (stroker)` : `${dev.name} m${Number(p.motor) + 1}` : `Pad ${i + 1}`);
        const msel = row.querySelector(".outm");
        const modes = p && p.motor === "l" ? [[FOLLOW_STROKER, "Stroker: follows the position"], [FOLLOW_AI, "✨ AI feel: strokes from a vibration's mood"]] : [[FOLLOW_AI, "✨ AI feel: patterns from the stroke's mood"], ...Object.entries(RUN_MODES).map(([v, t]) => [v, t.replace(/ \(vibration scripts\)/, "")]), [FOLLOW_STROKER, "Stroker: level = position"]];
        const mkey = JSON.stringify(modes);
        if (msel.dataset.key !== mkey) {
          msel.replaceChildren(...modes.map(([v, t]) => new Option(t, v)));
          msel.dataset.key = mkey;
        }
        if (!modes.some(([v]) => v === this._outs[i].m)) this._outs[i].m = p && p.motor !== "l" && this._outs[i].m !== FOLLOW_AI ? "position" : modes[0][0];
        msel.value = this._outs[i].m;
        const owner = dev && this._claimedBy(dev);
        const take = row.querySelector(".outtake");
        take.hidden = !owner;
        if (owner) take.textContent = `Take control (${owner.label || "in use"})`;
        msel.hidden = value === "off" || Boolean(owner);
        row.classList.toggle("solo", msel.hidden);
        row.classList.toggle("take", Boolean(owner));
      }
      this._padLabels = labels;
      for (const [i, id] of [[0, "pad1"], [1, "pad2"]]) {
        const lab = this._el(id).querySelector(".lab");
        if (lab.textContent !== labels[i]) lab.textContent = labels[i];
      }
      const two = this._twoPads;
      this._el("pad2").hidden = !two;
      this._el("pads").classList.toggle("dual", two);
      const busy = this._devices.some((d) => this._claimedBy(d));
      const note = this._outBlocked ? "A device is being controlled from another phone or browser: it does not follow here until you take control." : busy ? "Some devices are in use elsewhere." : "";
      if (this._el("outnote").textContent !== note) this._el("outnote").textContent = note;
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
          if (pos !== this._last[i]) {
            this._samples[i].push({ at: t, pos });
            this._last[i] = pos;
          }
        });
        $("timer").textContent = fmt(t);
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
      this._setLive($("live").checked);
      for (const i of [0, 1]) if (this._samples[i].length) {
        this._samples[i].push({ at: t, pos: this._last[i] });
        this._samples[i].push({ at: t + 1, pos: 0 });
      }
      const take = { version: "1.0", inverted: false, range: 100, actions: this._samples[0], metadata: { creator: "OggStudio", type: "vibration" } };
      if (this._twoPads && this._samples[1].length) take.channels = { V1: { actions: this._samples[1] } };
      this._take = take.actions.length ? take : null;
      $("timer").textContent = "";
      this._setPad(0, 0);
      this._setPad(1, 0);
      this._update();
    }
    // Take and library playback run through Replay: the devices above,
    // each following its own way, and the pads or bar show it.
    _play(script) {
      this._playScript(script, "Current take", null);
    }
    async _playSaved() {
      const name = this._el("saved").value;
      try {
        this._playScript(await this._getSaved(name), name, name);
      } catch (e) {
        this._toast("Could not load the script: " + (e.message || e));
      }
    }
    _playScript(script, name, lib) {
      if (!script) return;
      this._plOff();
      this._setCtl("replay");
      this._rpLoad(script, name, lib);
      if (SPEEDS.includes(this._el("speed").value)) this._el("rpspeed").value = this._el("speed").value;
      this._el("rploop").checked = this._el("loop").checked;
      this._rpPlay();
    }
    _stop() {
      this._rpStop();
    }
    async _save() {
      const name = this._el("name").value.trim();
      if (!name) {
        this._toast("Type a name first");
        return;
      }
      try {
        await this._hass.callService("oggstudio", "save", { name, script: this._take, ...isStroke(this._take) && RUN_MODES[this._outs[0].m] ? { mode: this._outs[0].m } : {} });
        this._toast(`Saved "${name}"`);
        this._take = null;
        this._el("name").value = "";
        this._update();
      } catch (e) {
        this._toast(e.message || String(e));
      }
    }
    // A saved script's details from the Saved script entity: kind
    // (stroke/vibration) and the run mode last used for it.
    _scriptInfo(name) {
      const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
      return name && saved && saved.attributes.scripts && saved.attributes.scripts[name] || null;
    }
    _setMode(name, mode) {
      this._hass.callService("oggstudio", "set_mode", { name, mode }, void 0, false).catch(() => {
      });
    }
    _download(script, name) {
      if (!script) return;
      const blob = new Blob([JSON.stringify(script)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const base = String(name).replace(/[\\/:*?"<>|]+/g, "_").replace(/(\.vib)?(\.funscript)?$/i, "");
      a.download = `${base}${isStroke(script) ? "" : ".vib"}.funscript`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5e3);
    }
    async _getSaved(name) {
      const res = await this._hass.callWS({ type: "call_service", domain: "oggstudio", service: "get_script", service_data: { name }, return_response: true });
      return res.response.script;
    }
    async _copySaved() {
      try {
        await this._copy(await this._getSaved(this._el("saved").value));
      } catch (e) {
        this._toast(e.message || String(e));
      }
    }
    async _copy(script) {
      if (!script) return;
      const code = await encodeCode(script);
      try {
        await navigator.clipboard.writeText(code);
        this._toast(`Code copied (${code.length} characters)`);
      } catch (e) {
        const out = this._el("codeout");
        out.hidden = false;
        out.value = code;
        out.select();
        this._toast("Clipboard unavailable: the code is shown in the Import box; copy it from there.");
      }
    }
    async _delete() {
      const name = this._el("saved").value;
      if (!name || !confirm(`Delete "${name}"?`)) return;
      try {
        await this._hass.callService("oggstudio", "delete", { name });
        this._toast(`Deleted "${name}"`);
      } catch (e) {
        this._toast(e.message || String(e));
      }
    }
    async _import() {
      const $ = this._el;
      const mode = "auto";
      const inverted = $("invert").checked;
      try {
        const files = [...$("files").files];
        let script;
        if (files.length) {
          const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
          const first = parsed[0];
          if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
          if (!first.metadata || !first.metadata.title) first.metadata = { ...first.metadata || {}, title: fileTitle(files[0].name) };
          script = normalise(first, fileKind(files[0].name, mode), inverted);
        } else if ($("paste").value.trim()) {
          script = normalise(await decodeText($("paste").value), mode, inverted);
        } else {
          this._toast("Paste a script or choose a file first");
          return;
        }
        this._take = script;
        $("name").value = script.metadata && script.metadata.title || "";
        $("paste").value = "";
        $("files").value = "";
        if (isStroke(script)) $("takemode").value = RUN_MODE_DEFAULT;
        this._toast(`Loaded ${fmt(duration(script))} ${isStroke(script) ? "stroke" : "vibration"} script. Play it now or save it.`);
        this._update();
      } catch (e) {
        this._toast("Could not import: " + (e.message || e));
      }
    }
    _fillVideoScripts() {
      const sel = this._el("vsrc");
      const savedState = this._studio && this._studio.saved && this._hass.states[this._studio.saved];
      const names = (savedState && savedState.attributes.options || []).filter((n) => n && !/^\(.*\)$/.test(n));
      const take = this._take ? `Current take (${isStroke(this._take) ? "stroke" : "vibration"}, ${fmt(duration(this._take))})` : null;
      const key = JSON.stringify([names, take]);
      if (sel.dataset.key === key) return;
      const current = sel.value;
      sel.replaceChildren(new Option("From a file on this device…", ""), ...take ? [new Option(take, TAKE_SRC)] : [], ...names.map((n) => new Option(`Library: ${n}`, n)));
      sel.dataset.key = key;
      if ([...sel.options].some((o) => o.value === current)) sel.value = current;
      else if (current === TAKE_SRC) {
        sel.value = "";
        this._loadVideoScript();
      }
      this._el("vfilebox").hidden = sel.value !== "";
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
      if (this._liveProblem) {
        this._liveProblem = null;
        this._toast("");
      }
      this._hass.callService("ogg", "live", { entity_id: dev.stop, levels, seconds }, void 0, false).catch((e) => {
        this._liveBackoffUntil = performance.now() + 3e3;
        this._toastOnce(`Could not control ${dev.name}: ${e.message || e}. Retrying…`);
      });
    }
    _quietStop(dev) {
      if (!dev || !this._hass) return;
      this._hass.callService("ogg", "stop_script", { entity_id: dev.stop }, void 0, false).catch(() => {
      });
    }
    _toastOnce(text) {
      if (this._liveProblem === text) return;
      this._liveProblem = text;
      this._toast(text);
    }
    _toast(text) {
      if (this._el) this._el("toast").textContent = text;
    }
    disconnectedCallback() {
      clearInterval(this._liveTimer);
      clearInterval(this._sampleTimer);
      this._stHalt();
      this._gpDetach();
      if (this._vsyncTimer) this._videoHalt();
      if (this._cast) this._castEnd(true);
      if (this._vurl) {
        URL.revokeObjectURL(this._vurl);
        this._vurl = null;
      }
      if (this._rp && this._rp.playing) {
        this._plOff();
        this._rpStop();
      }
      this._auStop();
      this._tgEnd();
      clearInterval(this._lockTimer);
      this._lockTimer = null;
      this._outStop();
      this._sessionClose();
    }
  };

  // frontend/src/card/safety.js
  var PRIVACY_KEY = "oggstudio_privacy";
  var UNLOCK_KEY = "oggstudio_unlocked";
  var PANIC_HOLD_MS = 3e3;
  var SafetyPart = class {
    // ---------------------------------------------------------- safety
    // Stop all: stops every Ogg device (not only this card's), halts whatever
    // this card was doing and keeps it quiet for a few seconds. Home Assistant
    // tells every other open card to do the same.
    _bindSafety() {
      const $ = this._el;
      $("stopall").addEventListener("click", () => this._panic());
      $("coverstop").addEventListener("click", () => this._panic());
      $("limbtn").addEventListener("click", () => {
        $("limbox").hidden = !$("limbox").hidden;
        this._limRender(true);
      });
      $("lockbtn").addEventListener("click", () => this._lock());
      $("coveropen").addEventListener("click", () => this._unlocked());
      $("pingo").addEventListener("click", () => this._pinTry());
      $("pin").addEventListener("keydown", (e) => {
        if (e.key === "Enter") this._pinTry();
      });
      this.shadowRoot.addEventListener("pointerdown", () => this._touched(), true);
      if (!this._pageHide) {
        this._pageHide = () => {
          if (this._claimed.size) this._outStop();
        };
        window.addEventListener("pagehide", this._pageHide);
      }
      try {
        this._privacy = JSON.parse(localStorage.getItem(PRIVACY_KEY) || "null") || {};
      } catch (_) {
        this._privacy = {};
      }
      this._privacyShow();
    }
    _panic() {
      this._haltAll();
      this._toast("Everything stopped.");
      if (this._hass) this._hass.callService("oggstudio", "panic", {}, void 0, false).catch((e) => this._toast("Stop all did not reach Home Assistant: " + (e.message || e)));
    }
    // Halt whatever this card is doing and hold its output for a moment.
    _haltAll() {
      if (!this._el) return;
      const $ = this._el;
      this._holdUntil = performance.now() + PANIC_HOLD_MS;
      if (this._recording) this._stopRecording();
      if (this._stRecording) this._stStop();
      if (this._live) {
        $("live").checked = false;
        this._setLive(false);
      }
      $("stlive").checked = false;
      if (this._st) {
        this._st.touch = null;
        this._st.pad = null;
        this._st.drag = null;
        this._st.latch = null;
      }
      this._stHalt();
      if (this._pl) this._pl.on = false;
      this._rpStop();
      const video = $("video");
      if (video && !video.paused) video.pause();
      this._auStop();
      this._tgStopLocal(true);
      this._outStop();
      this._plShow();
    }
    // The session tells Home Assistant this card is alive: when the browser
    // goes away (closed, crashed, off the network) it stops this card's devices.
    _sessionOpen() {
      if (this._sessionUnsub || this._sessionOpening || !this.isConnected) return;
      const conn = this._hass && this._hass.connection;
      if (!conn || !conn.subscribeMessage || !this._studio || !this._studio.saved) return;
      this._sessionOpening = true;
      conn.subscribeMessage(() => {
      }, { type: "oggstudio/session", owner: this._owner }).then((unsub) => {
        this._sessionUnsub = unsub;
        if (!this.isConnected) this._sessionClose();
      }).catch(() => {
        this._sessionFailed = true;
      }).finally(() => {
        this._sessionOpening = false;
      });
    }
    _sessionClose() {
      const unsub = this._sessionUnsub;
      this._sessionUnsub = null;
      if (unsub) {
        try {
          Promise.resolve(unsub()).catch(() => {
          });
        } catch (_) {
        }
      }
    }
    // Called from _update on every state change.
    _safetyUpdate() {
      const saved = this._studio && this._hass.states[this._studio.saved];
      const attrs = saved && saved.attributes || {};
      if (!this._sessionFailed) this._sessionOpen();
      if (saved) {
        const panic = attrs.panic || 0;
        if (this._panicSeen !== void 0 && panic !== this._panicSeen) {
          this._haltAll();
          this._toast("Everything was stopped.");
        }
        this._panicSeen = panic;
      }
      this._limitsAll = attrs.limits || {};
      if (saved && attrs.settings) {
        const s = attrs.settings;
        const next = { pin: Boolean(s.pin), discreet: Boolean(s.discreet), name: s.name || "Studio", users: s.users || [], auto_lock: Number(s.auto_lock) || 0 };
        if (JSON.stringify(next) !== JSON.stringify(this._privacy)) {
          this._privacy = next;
          try {
            localStorage.setItem(PRIVACY_KEY, JSON.stringify(next));
          } catch (_) {
          }
        }
      }
      const discreet = Boolean(this._privacy.discreet);
      [...this._devices].sort((a, b) => (a.real || a.name).localeCompare(b.real || b.name)).forEach((d, i) => {
        if (!d.real) d.real = d.name;
        d.name = discreet ? `Device ${String.fromCharCode(65 + i % 26)}` : d.real;
      });
      this._privacyShow();
      this._limRender(false);
    }
    // ---------------------------------------------------------- limits
    _limits(dev) {
      return limitsFor(this._limitsAll, dev.stop);
    }
    _limRender(force) {
      const $ = this._el;
      const lims = this._devices.map((d) => [d, this._limits(d)]);
      const any = lims.filter(([, l]) => isLimited(l));
      const label = any.length ? `⚙ Limits (${any.length} set)` : "⚙ Limits";
      if ($("limbtn").textContent !== label) $("limbtn").textContent = label;
      if ($("limbox").hidden) return;
      const key = JSON.stringify(lims.map(([d, l]) => [d.id, d.name, l]));
      if (!force && (key === $("limbox").dataset.key || $("limbox").contains(this.shadowRoot.activeElement))) return;
      $("limbox").dataset.key = key;
      const slider = (dev, field, text, min, value) => `<label>${text} <b data-v="${field}">${value}%</b></label><input type="range" min="${min}" max="100" step="1" value="${value}" data-dev="${esc(dev.stop)}" data-field="${field}">`;
      const rows = lims.map(([d, l]) => {
        const vibe = d.vibe || !d.linear;
        return `<div class="limdev"><h4>${esc(d.name)}</h4>` + (vibe ? slider(d, "max", "Top intensity", 0, l.max) : "") + (d.linear ? slider(d, "lo", "Stroke range from", 0, l.lo) + slider(d, "hi", "Stroke range to", 0, l.hi) + slider(d, "speed", "Top stroke speed", 5, l.speed) : "") + "</div>";
      });
      $("limlist").innerHTML = rows.join("") || '<div class="hint">No devices yet.</div>';
      for (const input of $("limlist").querySelectorAll("input")) {
        input.addEventListener("input", () => {
          input.previousElementSibling.querySelector("b").textContent = `${input.value}%`;
        });
        input.addEventListener("change", () => this._limSet(input));
      }
    }
    _limSet(input) {
      const stop = input.dataset.dev;
      const dev = this._devices.find((d) => d.stop === stop);
      if (!dev) return;
      const lim = { ...this._limits(dev), [input.dataset.field]: Number(input.value) };
      if (lim.hi - lim.lo < 5) {
        if (input.dataset.field === "lo") lim.hi = Math.min(100, lim.lo + 5);
        else lim.lo = Math.max(0, lim.hi - 5);
      }
      if (lim.hi - lim.lo < 5) {
        lim.lo = 0;
        lim.hi = 100;
      }
      this._limitsAll = { ...this._limitsAll, [stop]: lim };
      this._hass.callService("oggstudio", "set_limits", { entity_id: stop, ...lim }).then(() => this._toast(`Limits for ${dev.name}: ${limitsText(lim) || "none"}.`)).catch((e) => this._toast("Could not save the limits: " + (e.message || e)));
      this._limRender(true);
    }
    // ---------------------------------------------------------- privacy
    // A PIN or discreet mode covers the card until it is opened; it locks
    // again after a while unused. The PIN is checked by Home Assistant.
    get _needsLock() {
      return Boolean(this._privacy && (this._privacy.pin || this._privacy.discreet));
    }
    _lockedNow() {
      if (!this._needsLock) return false;
      let at = 0;
      try {
        at = Number(sessionStorage.getItem(UNLOCK_KEY)) || 0;
      } catch (_) {
        at = this._unlockAt || 0;
      }
      if (!at) return true;
      const minutes = this._privacy.auto_lock || 0;
      if (minutes && !this._claimed.size && Date.now() - at > minutes * 6e4) return true;
      return false;
    }
    _touched() {
      if (!this._needsLock || this._isLocked) return;
      const now = Date.now();
      if (now - (this._unlockAt || 0) < 5e3) return;
      this._unlockAt = now;
      try {
        sessionStorage.setItem(UNLOCK_KEY, String(now));
      } catch (_) {
      }
    }
    _unlocked() {
      this._unlockAt = Date.now();
      try {
        sessionStorage.setItem(UNLOCK_KEY, String(this._unlockAt));
      } catch (_) {
      }
      this._el("pin").value = "";
      this._el("covermsg").textContent = "";
      this._privacyShow();
    }
    _lock() {
      this._unlockAt = 0;
      try {
        sessionStorage.removeItem(UNLOCK_KEY);
      } catch (_) {
      }
      this._privacyShow();
    }
    async _pinTry() {
      const $ = this._el;
      const pin = $("pin").value;
      if (!pin || this._pinBusy) return;
      this._pinBusy = true;
      try {
        const r = await this._hass.callWS({ type: "oggstudio/unlock", pin });
        if (r && r.ok) this._unlocked();
        else {
          $("pin").value = "";
          $("covermsg").textContent = r && r.wait ? `Too many tries. Wait ${r.wait} s.` : "That is not the PIN.";
        }
      } catch (e) {
        $("covermsg").textContent = "Could not check the PIN: " + (e.message || e);
      }
      this._pinBusy = false;
    }
    _privacyShow() {
      if (!this._el) return;
      const $ = this._el;
      const p = this._privacy || {};
      const me = this._hass && this._hass.user && this._hass.user.id;
      const hide = Boolean(p.users && p.users.length && me && !p.users.includes(me));
      if (this.hidden !== hide) {
        this.hidden = hide;
        this.style.display = hide ? "none" : "";
      }
      const cardEl = this.shadowRoot.querySelector("ha-card");
      if (this._claimed.size) this._touched();
      const locked = this._lockedNow();
      this._isLocked = locked;
      cardEl.classList.toggle("locked", locked);
      $("cover").hidden = !locked;
      const neutral = p.discreet || locked;
      const title = neutral ? p.name || "Studio" : this._config.title || this._variant.name;
      if ($("title").textContent !== title) $("title").textContent = title;
      if ($("covername").textContent !== (p.name || "Studio")) $("covername").textContent = p.name || "Studio";
      $("sub").hidden = Boolean(p.discreet);
      $("lockbtn").hidden = !this._needsLock;
      $("coverpin").hidden = !p.pin;
      $("coveropen").hidden = Boolean(p.pin);
      if (this._needsLock && !this._lockTimer) this._lockTimer = setInterval(() => this._privacyShow(), 2e4);
    }
  };

  // frontend/src/lib/tools.js
  var HEAT_FULL_SPEED = 400;
  function heatmap(script, buckets) {
    const len = duration(script);
    const out = new Array(buckets).fill(0);
    if (!len || !buckets) return out;
    const tracks = [script.actions];
    if (script.channels && script.channels.V1 && script.channels.V1.actions.length) tracks.push(script.channels.V1.actions);
    const stroke = isStroke(script);
    const step = len / buckets;
    for (const actions of tracks) {
      if (stroke) {
        for (let i = 1; i < actions.length; i++) {
          const a = actions[i - 1], b = actions[i];
          const dt = b.at - a.at;
          if (dt <= 0) continue;
          const speed = Math.abs(b.pos - a.pos) / dt * 1e3;
          const first = Math.min(buckets - 1, Math.floor(a.at / step)), last = Math.min(buckets - 1, Math.floor((b.at - 1e-3) / step));
          for (let k = first; k <= last; k++) {
            const share = (Math.min(b.at, (k + 1) * step) - Math.max(a.at, k * step)) / step;
            out[k] = Math.max(out[k], Math.min(1, speed / HEAT_FULL_SPEED) * Math.min(1, Math.max(0, share) * 1.5));
          }
        }
      } else {
        for (let k = 0; k < buckets; k++) {
          let sum = 0;
          for (let j = 0; j < 4; j++) sum += sampleAt(actions, (k + (j + 0.5) / 4) * step);
          out[k] = Math.max(out[k], sum / 400);
        }
      }
    }
    return out;
  }
  function heatColor(v) {
    const x = Math.min(1, Math.max(0, v));
    const hue = 215 - 215 * Math.min(1, x * 1.15);
    return `hsl(${Math.round(hue)},${Math.round(55 + 30 * x)}%,${Math.round(22 + 30 * x)}%)`;
  }
  var cutTrack = (actions, from, to) => {
    if (!actions.length) return [];
    const inside = actions.filter((a) => a.at > from && a.at < to).map((a) => ({ at: Math.round(a.at - from), pos: a.pos }));
    const edge = (ms) => Math.round(sampleAt(actions, ms));
    return [{ at: 0, pos: edge(from) }, ...inside, { at: Math.round(to - from), pos: edge(to) }];
  };
  var withTracks = (script, main, second) => {
    const out = { ...script, actions: main };
    delete out.mood;
    delete out.channels;
    if (second && second.length) out.channels = { V1: { actions: second } };
    return out;
  };
  var secondOf = (script) => script.channels && script.channels.V1 && script.channels.V1.actions.length ? script.channels.V1.actions : null;
  function trimScript(script, from, to) {
    const len = duration(script);
    const a = Math.min(len, Math.max(0, Math.round(from))), b = Math.min(len, Math.max(0, Math.round(to)));
    if (b - a < 100) throw new Error("Nothing left: keep at least a tenth of a second");
    const second = secondOf(script);
    return withTracks(script, cutTrack(script.actions, a, b), second && cutTrack(second, a, b));
  }
  var shifted = (actions, by) => actions.map((a) => ({ at: a.at + by, pos: a.pos }));
  var joined = (first, next, by) => {
    const out = first.slice();
    for (const a of shifted(next, by)) {
      const last = out[out.length - 1];
      if (last && a.at <= last.at) {
        if (a.pos === last.pos) continue;
        a.at = last.at + 1;
      }
      out.push(a);
    }
    return out;
  };
  function loopScript(script, n) {
    const times = Math.min(50, Math.max(1, Math.round(n)));
    const len = duration(script);
    if (!len) throw new Error("The script is empty");
    const second = secondOf(script);
    let main = [], other = [];
    for (let i = 0; i < times; i++) {
      main = joined(main, script.actions, i * len);
      if (second) other = joined(other, second, i * len);
    }
    return withTracks(script, main, second && other);
  }
  function stitchScripts(a, b, gapMs = 500) {
    if (isStroke(a) !== isStroke(b)) throw new Error("A stroke script and a vibration script cannot be joined");
    const by = duration(a) + Math.max(0, Math.round(gapMs));
    const sa = secondOf(a), sb = secondOf(b);
    const second = sa || sb ? joined(sa || a.actions, sb || b.actions, by) : null;
    return withTracks(a, joined(a.actions, b.actions, by), second);
  }

  // frontend/src/card/tools.js
  var QUEUE_KEY = "oggstudio_queue";
  var TAKE_HEAT = "\0take";
  var paintHeat = (canvas, heat) => {
    canvas.width = heat.length;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    heat.forEach((v, i) => {
      ctx.fillStyle = heatColor(v);
      ctx.fillRect(i, 0, 1, 1);
    });
  };
  var ToolsPart = class {
    // ---------------------------------------------------------- script tools
    // A heatmap on the replay bar and in the picker; trim, repeat and stitch
    // (each result becomes the current take); and a queue of scripts and moods.
    _bindTools() {
      const $ = this._el;
      $("tlbtn").addEventListener("click", () => {
        $("tlbox").hidden = !$("tlbox").hidden;
        $("plbox").hidden = true;
        this._toolsUpdate();
      });
      $("plbtn").addEventListener("click", () => {
        $("plbox").hidden = !$("plbox").hidden;
        $("tlbox").hidden = true;
        this._toolsUpdate();
        this._plShow();
      });
      $("tlstart").addEventListener("click", () => this._tlTrim(false));
      $("tlend").addEventListener("click", () => this._tlTrim(true));
      $("tlloop").addEventListener("click", () => this._tlEdit((raw) => loopScript(raw, Number($("tln").value)), `Repeated ${$("tln").value} times.`));
      $("tlstitch").addEventListener("click", () => this._tlStitch());
      $("tln").replaceChildren(...[2, 3, 4, 5, 8, 10, 20].map((n) => new Option(`× ${n}`, String(n))));
      let kept = null;
      try {
        kept = JSON.parse(localStorage.getItem(QUEUE_KEY) || "null");
      } catch (_) {
      }
      const items = kept && Array.isArray(kept.items) ? kept.items.filter((it) => it && (typeof it.script === "string" || typeof it.mood === "string")) : [];
      this._pl = { items, loop: Boolean(kept && kept.loop), i: -1, on: false, run: 0, busy: false };
      $("plloop").checked = this._pl.loop;
      $("plloop").addEventListener("change", () => {
        this._pl.loop = $("plloop").checked;
        this._plKeep();
      });
      $("pladdbtn").addEventListener("click", () => {
        const v = $("pladd").value;
        if (!v) return;
        this._pl.items.push(v.startsWith("m:") ? { mood: v.slice(2) } : { script: v.slice(2) });
        this._plKeep();
        this._plShow();
      });
      $("plplay").addEventListener("click", () => {
        if (this._pl.on) {
          this._plOff();
          this._rpStop();
        } else this._plPlay(0);
      });
      $("plsaved").addEventListener("change", () => this._plLoadSaved());
      $("plsave").addEventListener("click", () => this._plSave());
      $("pldel").addEventListener("click", () => this._plDelete());
      $("pllist").addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        const i = Number(b.parentElement.dataset.i), pl = this._pl;
        const act = b.dataset.act;
        if (act === "go") {
          this._plPlay(i);
          return;
        }
        if (pl.on) {
          this._plOff();
          this._rpStop();
        }
        if (act === "x") pl.items.splice(i, 1);
        const j = act === "up" ? i - 1 : act === "down" ? i + 1 : -1;
        if (j >= 0 && j < pl.items.length) [pl.items[i], pl.items[j]] = [pl.items[j], pl.items[i]];
        this._plKeep();
        this._plShow();
      });
      this._plShow();
    }
    _savedNames() {
      const saved = this._studio && this._hass && this._hass.states[this._studio.saved];
      return (saved && saved.attributes.options || []).filter((n) => n && !/^\(.*\)$/.test(n));
    }
    // Called from _update: the lists that follow the library.
    _toolsUpdate() {
      if (!this._pl) return;
      const $ = this._el;
      const names = this._savedNames();
      const saved = this._studio && this._hass.states[this._studio.saved];
      const lists = Object.keys(saved && saved.attributes.playlists || {}).sort((a, b) => a.localeCompare(b));
      const key = JSON.stringify([names, lists]);
      if ($("tlbox").dataset.key === key) return;
      $("tlbox").dataset.key = key;
      $("tlother").replaceChildren(new Option(names.length ? "Choose a saved script…" : "No saved scripts yet", ""), ...names.map((n) => new Option(n, n)));
      $("pladd").replaceChildren(
        new Option("Add a script or mood…", ""),
        ...names.map((n) => new Option(n, `s:${n}`)),
        ...Object.entries(MOODS).map(([k, m]) => new Option(`${m.icon} Mood: ${m.label}`, `m:${k}`))
      );
      $("plsaved").replaceChildren(new Option(lists.length ? "Open a saved queue…" : "No saved queues yet", ""), ...lists.map((n) => new Option(n, n)));
    }
    // ---- heatmap
    _heatShow() {
      const rp = this._rp;
      if (!this._el || !rp || this._heatFor === rp.raw) return;
      this._heatFor = rp.raw;
      const canvas = this._el("rpheat");
      this._el("rpbar").classList.toggle("heat", Boolean(rp.raw));
      if (rp.raw) paintHeat(canvas, heatmap(rp.raw, 240));
    }
    // Small heatmaps under the picker's entries, fetched one at a time.
    async _pickHeats() {
      const run = this._heatRun = (this._heatRun || 0) + 1;
      this._heatCache = this._heatCache || {};
      for (const b of [...this._el("rplist").querySelectorAll("button[data-heat]")]) {
        const name = b.dataset.heat;
        let heat;
        if (name === TAKE_HEAT) heat = this._take && heatmap(this._take, 80);
        else {
          const info = this._scriptInfo(name);
          const key = `${name}:${info && info.duration_ms || 0}`;
          heat = this._heatCache[key];
          if (!heat) {
            try {
              heat = this._heatCache[key] = heatmap(await this._getSaved(name), 80);
            } catch (_) {
              continue;
            }
          }
        }
        if (run !== this._heatRun || this._el("rppop").hidden) return;
        if (!heat) continue;
        const c = document.createElement("canvas");
        c.className = "pkheat";
        paintHeat(c, heat);
        b.appendChild(c);
      }
    }
    // ---- trim, repeat, stitch
    _tlEdit(fn, done) {
      const rp = this._rp;
      if (!rp.raw) {
        this._toast("Choose a script first.");
        return;
      }
      if (rp.raw.mood) {
        this._toast("A mood cannot be edited: it is made new each time.");
        return;
      }
      try {
        const out = fn(rp.raw);
        out.metadata = { ...out.metadata || {} };
        this._plOff();
        this._take = out;
        this._rpLoad(out, "Current take", null);
        this._update();
        this._toast(`${done} It is now the current take (${fmt(duration(out))}): save it under a name to keep it.`);
      } catch (e) {
        this._toast(e.message || String(e));
      }
    }
    _tlTrim(end) {
      const t = this._rp.t, len = this._rp.len;
      this._tlEdit((raw) => end ? trimScript(raw, 0, t) : trimScript(raw, t, len), end ? `Cut everything after ${fmt(t)}.` : `Cut everything before ${fmt(t)}.`);
    }
    async _tlStitch() {
      const name = this._el("tlother").value;
      if (!name) {
        this._toast("Choose the script to add first.");
        return;
      }
      let other;
      try {
        other = await this._getSaved(name);
      } catch (e) {
        this._toast("Could not load the script: " + (e.message || e));
        return;
      }
      this._tlEdit((raw) => stitchScripts(raw, other), `Added "${name}" after it.`);
    }
    // ---- queue
    _plKeep() {
      try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify({ items: this._pl.items, loop: this._pl.loop }));
      } catch (_) {
      }
    }
    _plLabel(it) {
      if (it.mood) {
        const m = MOODS[it.mood];
        return m ? `${m.icon} Mood: ${m.label}` : `Mood: ${it.mood}`;
      }
      return it.script;
    }
    _plShow() {
      if (!this._el || !this._pl) return;
      const $ = this._el;
      const pl = this._pl;
      const label = pl.items.length ? `☰ Queue (${pl.items.length})` : "☰ Queue";
      if ($("plbtn").textContent !== label) $("plbtn").textContent = label;
      $("plbtn").classList.toggle("on", pl.on);
      $("plplay").textContent = pl.on ? "■ Stop queue" : "▶ Play queue";
      $("plplay").classList.toggle("stop", pl.on);
      if ($("plbox").hidden) return;
      $("pllist").innerHTML = pl.items.map((it, i) => `<div class="plitem${pl.on && i === pl.i ? " on" : ""}" data-i="${i}"><button type="button" class="plname" data-act="go">${i + 1}. ${esc(this._plLabel(it))}</button><button type="button" data-act="up" aria-label="Move up"${i ? "" : " disabled"}>↑</button><button type="button" data-act="down" aria-label="Move down"${i < pl.items.length - 1 ? "" : " disabled"}>↓</button><button type="button" data-act="x" aria-label="Remove">✕</button></div>`).join("") || '<div class="hint">The queue is empty: add scripts and moods below. They play in order. A mood plays one of its combos, then the queue moves on.</div>';
    }
    // The queue stops following (what is playing carries on).
    _plOff() {
      const pl = this._pl;
      if (!pl || !pl.on) return;
      pl.on = false;
      pl.i = -1;
      pl.run += 1;
      this._plShow();
    }
    _plNext() {
      const pl = this._pl;
      if (pl.busy) return;
      pl.busy = true;
      this._plPlay(pl.i + 1).finally(() => {
        pl.busy = false;
      });
    }
    async _plPlay(start) {
      const pl = this._pl;
      if (!pl.items.length) {
        this._toast("The queue is empty.");
        return;
      }
      const run = pl.run += 1;
      let i = start, done = false;
      for (let tried = 0; tried < pl.items.length; tried++, i++) {
        if (i >= pl.items.length) {
          if (!pl.loop) {
            done = true;
            break;
          }
          i = 0;
        }
        const it = pl.items[i];
        pl.on = true;
        pl.i = i;
        this._plShow();
        if (it.mood) {
          if (!MOODS[it.mood]) continue;
          this._mood = { key: it.mood, combo: -1 };
          this._moodNext(true);
          return;
        }
        let script;
        try {
          script = await this._getSaved(it.script);
        } catch (_) {
          script = null;
        }
        if (run !== pl.run) return;
        if (!script) {
          this._toast(`"${it.script}" is no longer in the library: skipped.`);
          continue;
        }
        this._mood = null;
        this._rpLoad(script, it.script, it.script);
        this._rpPlay();
        return;
      }
      pl.on = false;
      pl.i = -1;
      this._rpStop();
      this._plShow();
      this._toast(done ? "The queue has finished." : "Nothing in the queue could be played.");
    }
    _plLoadSaved() {
      const $ = this._el;
      const name = $("plsaved").value;
      const saved = this._studio && this._hass.states[this._studio.saved];
      const list = name && saved && saved.attributes.playlists && saved.attributes.playlists[name];
      if (!list) return;
      if (this._pl.on) {
        this._plOff();
        this._rpStop();
      }
      this._pl.items = (list.items || []).map((it) => ({ ...it }));
      this._pl.loop = Boolean(list.loop);
      $("plloop").checked = this._pl.loop;
      $("plname").value = name;
      this._plKeep();
      this._plShow();
    }
    async _plSave() {
      const name = this._el("plname").value.trim();
      if (!name) {
        this._toast("Type a name for the queue first.");
        return;
      }
      if (!this._pl.items.length) {
        this._toast("The queue is empty.");
        return;
      }
      try {
        await this._hass.callService("oggstudio", "save_playlist", { name, items: this._pl.items, loop: this._pl.loop });
        this._toast(`Saved the queue "${name}".`);
      } catch (e) {
        this._toast(e.message || String(e));
      }
    }
    async _plDelete() {
      const name = this._el("plsaved").value || this._el("plname").value.trim();
      if (!name || !confirm(`Delete the saved queue "${name}"?`)) return;
      try {
        await this._hass.callService("oggstudio", "delete_playlist", { name });
        this._toast(`Deleted the queue "${name}".`);
      } catch (e) {
        this._toast(e.message || String(e));
      }
    }
  };

  // frontend/src/lib/audio.js
  var AUDIO_MODES = { beat: "Beat: a pulse on every beat", bass: "Bass: follows the low end", volume: "Volume: follows the loudness" };
  var AUDIO_GATE = 0.02;
  var band = (bins, hzPerBin, from, to) => {
    const a = Math.max(1, Math.floor(from / hzPerBin)), b = Math.min(bins.length - 1, Math.ceil(to / hzPerBin));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += bins[i];
    return b >= a ? sum / ((b - a + 1) * 255) : 0;
  };
  var AudioFeel = class {
    constructor(sampleRate, fftSize) {
      this.hz = sampleRate / fftSize;
      this.reset();
    }
    reset() {
      this.hist = [];
      this.peak = { bass: 0.1, mid: 0.1, all: 0.1 };
      this.pulse = 0;
      this.beatAt = -1e9;
      this.last = null;
      this.smooth = [0, 0];
      this.beats = 0;
    }
    // One reading. sens 0-1: how easily it reacts. Returns { levels, beat }.
    step(bins, now, mode = "beat", sens = 0.5) {
      const dt = this.last === null ? 50 : Math.min(250, Math.max(1, now - this.last));
      this.last = now;
      const bass = band(bins, this.hz, 30, 180);
      const mid = band(bins, this.hz, 300, 4e3);
      const all = band(bins, this.hz, 30, 8e3);
      const fade = Math.pow(0.5, dt / 6e3);
      for (const [key, v] of [["bass", bass], ["mid", mid], ["all", all]]) this.peak[key] = Math.max(v, this.peak[key] * fade, 0.05);
      const gain = 0.6 + sens * 0.9;
      const rel = (v, key) => all < AUDIO_GATE ? 0 : Math.min(1, v / this.peak[key] * gain);
      const avg = this.hist.length ? this.hist.reduce((a, b) => a + b, 0) / this.hist.length : bass;
      this.hist.push(bass);
      while (this.hist.length > 24) this.hist.shift();
      const clear = 1.55 - sens * 0.45;
      const beat = all >= AUDIO_GATE && this.hist.length > 4 && bass > avg * clear && bass > 0.06 && now - this.beatAt > 200;
      if (beat) {
        this.beatAt = now;
        this.beats += 1;
        this.pulse = Math.min(1, 0.55 + rel(bass, "bass") * 0.45);
      } else this.pulse *= Math.pow(0.5, dt / 130);
      let first;
      if (mode === "bass") first = rel(bass, "bass");
      else if (mode === "volume") first = rel(all, "all");
      else first = Math.max(this.pulse, rel(bass, "bass") * 0.25);
      const second = rel(mid, "mid");
      const ease = (prev, v) => v >= prev ? v : prev + (v - prev) * Math.min(1, dt / 120);
      this.smooth = [ease(this.smooth[0], first), ease(this.smooth[1], second)];
      return { levels: this.smooth.map((v) => Math.round(v * 100)), beat };
    }
  };

  // frontend/src/card/audio.js
  var AUDIO_KEY = "oggstudio_audio";
  var AUDIO_HINT = "Sound drives the devices: a pulse on each beat, or following the bass or the loudness. Nothing is recorded or sent anywhere; only the levels reach the devices.";
  var AudioPart = class {
    // ---------------------------------------------------------- audio
    // The sound is analysed here in the browser, a few times a second.
    _bindAudio() {
      const $ = this._el;
      $("aumode").replaceChildren(...Object.entries(AUDIO_MODES).map(([v, t]) => new Option(t, v)));
      let kept = {};
      try {
        kept = JSON.parse(localStorage.getItem(AUDIO_KEY) || "{}") || {};
      } catch (_) {
      }
      if ([...$("ausrc").options].some((o) => o.value === kept.src)) $("ausrc").value = kept.src;
      if (AUDIO_MODES[kept.mode]) $("aumode").value = kept.mode;
      if (Number.isFinite(kept.sens)) $("ausens").value = String(kept.sens);
      const keep = () => {
        $("ausensv").textContent = `${$("ausens").value}%`;
        try {
          localStorage.setItem(AUDIO_KEY, JSON.stringify({ src: $("ausrc").value, mode: $("aumode").value, sens: Number($("ausens").value) }));
        } catch (_) {
        }
      };
      $("ausrc").addEventListener("change", () => {
        this._auStop();
        keep();
        this._auShow();
      });
      $("aumode").addEventListener("change", keep);
      $("ausens").addEventListener("input", keep);
      $("aufile").addEventListener("change", () => {
        const f = $("aufile").files[0];
        this._auStop();
        if (this._auUrl) URL.revokeObjectURL(this._auUrl);
        this._auUrl = f ? URL.createObjectURL(f) : null;
        if (f) $("auel").src = this._auUrl;
        else $("auel").removeAttribute("src");
        this._auShow();
      });
      $("augo").addEventListener("click", () => this._au ? this._auStop() : this._auStart());
      $("ausensv").textContent = `${$("ausens").value}%`;
      this._auShow();
    }
    async _auStart() {
      const $ = this._el;
      const src = $("ausrc").value;
      let stream = null;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) throw new Error("this browser cannot analyse sound");
        const ctx = this._auCtx || (this._auCtx = new AC());
        if (ctx.state === "suspended") await ctx.resume();
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        an.smoothingTimeConstant = 0.3;
        let node;
        if (src === "mic" || src === "tab") {
          if (!window.isSecureContext || !navigator.mediaDevices) throw new Error("the microphone and shared audio need Home Assistant opened over https (or in its app). A music file or the video works anywhere");
          if (src === "mic") stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
          else {
            if (!navigator.mediaDevices.getDisplayMedia) throw new Error("this browser cannot share audio from another tab");
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
          }
          const track = stream.getAudioTracks()[0];
          if (!track) throw new Error('no sound was shared: pick a browser tab and tick "Also share tab audio"');
          for (const t of stream.getVideoTracks()) t.enabled = false;
          node = ctx.createMediaStreamSource(stream);
          node.connect(an);
          track.addEventListener("ended", () => {
            if (this._au && this._au.stream === stream) this._auStop();
          });
        } else {
          const el = src === "video" ? $("video") : $("auel");
          if (!el.currentSrc && !el.src) throw new Error(src === "video" ? "load a video in Video sync first" : "choose a music file first");
          this._auNodes = this._auNodes || /* @__PURE__ */ new Map();
          node = this._auNodes.get(el);
          if (!node) {
            node = ctx.createMediaElementSource(el);
            node.connect(ctx.destination);
            this._auNodes.set(el, node);
          }
          node.connect(an);
          if (src === "file") el.play().catch(() => {
          });
        }
        this._rpStop();
        this._au = { src, an, node, stream, feel: new AudioFeel(ctx.sampleRate, an.fftSize), bins: new Uint8Array(an.frequencyBinCount), outAt: 0 };
        clearInterval(this._auTimer);
        this._auTimer = setInterval(() => this._auTick(), 50);
        this._toast("");
      } catch (e) {
        if (stream) for (const t of stream.getTracks()) t.stop();
        const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
        this._toast(denied ? "Audio: permission was not given." : `Audio: ${e.message || e}.`);
      }
      this._auShow();
    }
    _auTick() {
      const au = this._au;
      if (!au || !this._el) return;
      const $ = this._el;
      const now = performance.now();
      au.an.getByteFrequencyData(au.bins);
      const r = au.feel.step(au.bins, now, $("aumode").value, Number($("ausens").value) / 100);
      $("aum1").style.width = `${r.levels[0]}%`;
      $("aum2").style.width = `${r.levels[1]}%`;
      if (now - au.outAt < 100) return;
      au.outAt = now;
      this._outApply([0, 1].map((i) => i && !this._twoPads ? null : this._mapLive(i, r.levels[i], 0)), 0.6);
      if (now - (au.shownAt || 0) > 1e3) {
        au.shownAt = now;
        this._auShow();
      }
    }
    _auStop() {
      const au = this._au;
      if (!au) return;
      this._au = null;
      clearInterval(this._auTimer);
      this._auTimer = null;
      try {
        au.node.disconnect(au.an);
      } catch (_) {
      }
      if (au.stream) for (const t of au.stream.getTracks()) t.stop();
      if (au.src === "file" && this._el) this._el("auel").pause();
      this._outStop();
      this._auShow();
    }
    _auShow() {
      if (!this._el) return;
      const $ = this._el;
      const au = this._au;
      $("aufilebox").hidden = $("ausrc").value !== "file";
      $("augo").textContent = au ? "■ Stop" : "♪ Start";
      $("augo").classList.toggle("stop", Boolean(au));
      if (!au) {
        $("aum1").style.width = "0";
        $("aum2").style.width = "0";
      }
      const from = { mic: "the microphone", file: "the music file", video: "the video", tab: "the shared audio" };
      $("auinfo").textContent = au ? `Listening to ${from[au.src]} · ${au.feel.beats} beats` : AUDIO_HINT;
      const tab = this.shadowRoot.querySelector('.ctltabs [data-ctl="audio"]');
      if (tab) tab.classList.toggle("live", Boolean(au));
    }
  };

  // frontend/src/card/together.js
  var TG_LINK = /^https?:\/\/[^\s/]+(\/[^\s?#]*)?\/api\/oggstudio\/together\/[\w-]+\/?$/;
  var TG_FRESH_MS = 1500;
  var TogetherPart = class {
    // ---------------------------------------------------------- together
    // Two people, two places: each one's slider drives the other's devices,
    // by feel and inside the limits each has set. Only levels (0-100) travel;
    // a partner never reaches Home Assistant itself. Whoever starts shares a
    // link; the other opens it in a browser, or joins from their own card.
    _bindTogether() {
      const $ = this._el;
      $("tgstart").addEventListener("click", () => this._tgStart());
      $("tgjoin").addEventListener("click", () => this._tgJoin());
      $("tglink").addEventListener("keydown", (e) => {
        if (e.key === "Enter") this._tgJoin();
      });
      $("tgcopy").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText($("tgshare").value);
          this._toast("Link copied. Send it only to your partner: whoever has it can join.");
        } catch (_) {
          $("tgshare").select();
          this._toast("Copy the selected link.");
        }
      });
      $("tgsend").addEventListener("input", () => {
        $("tgsendv").textContent = `${$("tgsend").value}%`;
      });
      $("tgaccept").addEventListener("change", () => this._tgShow());
      $("tgstop").addEventListener("click", () => {
        this._tgStopLocal(true);
        this._toast("Stopped both sides.");
      });
      $("tgend").addEventListener("click", () => this._tgEnd());
      this._tgShow();
    }
    _tgNew(role) {
      if (this._tg) this._tgEnd();
      const tg = { role, joined: false, theirs: false, name: "", in: null, link: "", token: null, sentAccept: null, lastOut: 0, outAt: 0, pingAt: 0, driving: false };
      this._tg = tg;
      clearInterval(this._tgTimer);
      this._tgTimer = setInterval(() => this._tgTick(), 100);
      return tg;
    }
    async _tgStart() {
      const conn = this._hass && this._hass.connection;
      if (!conn || !conn.subscribeMessage) {
        this._toast("Not connected to Home Assistant.");
        return;
      }
      const tg = this._tgNew("host");
      try {
        const unsub = await conn.subscribeMessage((ev) => this._tgEvent(tg, ev), { type: "oggstudio/together" });
        if (this._tg !== tg) {
          unsub();
          return;
        }
        tg.unsub = unsub;
      } catch (e) {
        if (this._tg === tg) this._tgEnd();
        this._toast("Could not start a session: " + (e.message || e));
      }
      this._tgShow();
    }
    _tgEvent(tg, ev) {
      if (this._tg !== tg || !ev) return;
      if (ev.event === "open") {
        tg.token = ev.token;
        tg.link = String(ev.base || location.origin).replace(/\/+$/, "") + ev.path;
      } else if (ev.event === "join") this._tgJoined(tg);
      else if (ev.event === "leave") {
        tg.joined = false;
        tg.theirs = false;
        tg.in = null;
        tg.sentAccept = null;
        this._toast("Your partner left. The link still works if they come back.");
      } else if (ev.event === "msg") this._tgMsg(tg, ev.data || {});
      this._tgShow();
    }
    _tgJoined(tg) {
      tg.joined = true;
      tg.sentAccept = null;
      const discreet = this._privacy && this._privacy.discreet;
      const name = !discreet && this._hass && this._hass.user && String(this._hass.user.name || "").trim();
      if (name) this._tgSend({ name: name.slice(0, 30) });
    }
    _tgJoin() {
      const $ = this._el;
      const link = $("tglink").value.trim();
      if (!TG_LINK.test(link)) {
        this._toast("That is not a Together link: paste the whole link you were sent.");
        return;
      }
      if (location.protocol === "https:" && link.startsWith("http:")) {
        this._toast("This page is secure (https) and the link is not, so the browser will not connect. Open the link itself in a browser instead.");
        return;
      }
      let ws;
      try {
        ws = new WebSocket(link.replace(/^http/, "ws").replace(/\/+$/, "") + "/ws");
      } catch (e) {
        this._toast("Could not connect: " + (e.message || e));
        return;
      }
      const tg = this._tgNew("guest");
      tg.ws = ws;
      ws.addEventListener("open", () => {
        if (this._tg !== tg) return;
        $("tglink").value = "";
        this._tgJoined(tg);
        this._tgShow();
      });
      ws.addEventListener("message", (e) => {
        if (this._tg !== tg) return;
        let data = null;
        try {
          data = JSON.parse(e.data);
        } catch (_) {
          return;
        }
        if (data && typeof data === "object") {
          this._tgMsg(tg, data);
          this._tgShow();
        }
      });
      ws.addEventListener("close", () => {
        if (this._tg !== tg) return;
        this._toast(tg.joined ? "The session has ended." : "Could not join: the link has ended, or someone has already joined it.");
        this._tgEnd();
      });
      this._tgShow();
    }
    _tgSend(data) {
      const tg = this._tg;
      if (!tg || !tg.joined) return;
      if (tg.role === "host") {
        if (tg.token) this._hass.callWS({ type: "oggstudio/together_send", token: tg.token, data }).catch(() => {
        });
      } else if (tg.ws && tg.ws.readyState === 1) tg.ws.send(JSON.stringify(data));
    }
    _tgMsg(tg, d) {
      if (Array.isArray(d.v) && d.v.length && d.v.every((x) => Number.isFinite(x))) tg.in = { v: d.v.slice(0, 2).map((x) => Math.min(100, Math.max(0, x))), at: performance.now() };
      if (typeof d.accept === "boolean") tg.theirs = d.accept;
      if (typeof d.name === "string") tg.name = d.name.slice(0, 30);
      if (d.stop === true) {
        this._tgStopLocal(false);
        this._toast("Your partner stopped both sides.");
      }
    }
    // My devices follow my partner only while I say so, on the Together tab.
    get _tgAccepting() {
      const tg = this._tg;
      return Boolean(tg && tg.joined && this._ctl === "together" && this._el("tgaccept").checked);
    }
    _tgTick() {
      const tg = this._tg;
      if (!tg || !this._el) return;
      const $ = this._el;
      const now = performance.now();
      const accept = this._tgAccepting;
      if (tg.joined) {
        if (accept !== tg.sentAccept) {
          tg.sentAccept = accept;
          this._tgSend({ accept });
        }
        const out = Number($("tgsend").value) || 0;
        if (out !== tg.lastOut || out > 0 && now - tg.outAt >= 500) {
          tg.lastOut = out;
          tg.outAt = now;
          this._tgSend({ v: [out] });
        }
        if (now - tg.pingAt >= 1e4) {
          tg.pingAt = now;
          this._tgSend({ ping: true });
        }
      }
      const fresh = Boolean(tg.in && now - tg.in.at < TG_FRESH_MS);
      $("tgin").style.width = `${fresh ? Math.max(...tg.in.v) : 0}%`;
      if (accept && fresh) {
        tg.driving = true;
        const v = tg.in.v;
        this._outApply([0, 1].map((i) => i && !this._twoPads ? null : this._mapLive(i, v[i] ?? v[0], 0)), 0.6);
      } else if (tg.driving) {
        tg.driving = false;
        this._outStop();
      }
    }
    // Stop here: nothing in, nothing out. With `tell`, the partner's side stops too.
    _tgStopLocal(tell) {
      const tg = this._tg;
      if (!tg || !this._el) return;
      const $ = this._el;
      $("tgaccept").checked = false;
      $("tgsend").value = "0";
      $("tgsendv").textContent = "0%";
      tg.in = null;
      if (tell) this._tgSend({ stop: true });
      if (tg.driving) {
        tg.driving = false;
        this._outStop();
      }
      this._tgShow();
    }
    _tgEnd() {
      const tg = this._tg;
      if (!tg) return;
      this._tg = null;
      clearInterval(this._tgTimer);
      this._tgTimer = null;
      if (tg.unsub) {
        try {
          Promise.resolve(tg.unsub()).catch(() => {
          });
        } catch (_) {
        }
      }
      if (tg.ws) {
        try {
          tg.ws.close();
        } catch (_) {
        }
      }
      if (tg.driving) this._outStop();
      if (this._el) {
        const $ = this._el;
        $("tgaccept").checked = false;
        $("tgsend").value = "0";
        $("tgsendv").textContent = "0%";
        $("tgin").style.width = "0";
      }
      this._tgShow();
    }
    _tgShow() {
      if (!this._el) return;
      const $ = this._el;
      const tg = this._tg;
      $("tgidle").hidden = Boolean(tg);
      $("tglive").hidden = !tg;
      const tab = this.shadowRoot.querySelector('.ctltabs [data-ctl="together"]');
      if (tab) tab.classList.toggle("live", Boolean(tg));
      if (!tg) return;
      $("tgsharebox").hidden = tg.role !== "host" || !tg.link;
      if ($("tgshare").value !== tg.link) $("tgshare").value = tg.link;
      const who = tg.name || "Your partner";
      let text;
      if (!tg.joined) text = tg.role === "host" ? "Waiting for your partner to open the link…" : "Connecting…";
      else text = `${who} is here · ${tg.theirs ? "your slider drives their devices" : "they have not let you control yet"} · ${$("tgaccept").checked ? "they drive your devices" : "your devices do not follow them"}`;
      if ($("tgstat").textContent !== text) $("tgstat").textContent = text;
    }
  };

  // frontend/src/index.js
  for (const part of [StrokePart, GamepadPart, VideoPart, CastPart, ReplayPart, OutputsPart, SafetyPart, ToolsPart, AudioPart, TogetherPart]) {
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(part.prototype))) {
      if (key !== "constructor") Object.defineProperty(OggStudioCard.prototype, key, desc);
    }
  }
  if (!customElements.get(TAG)) {
    window.customCards = window.customCards || [];
    for (const [tag, variant] of Object.entries(VARIANTS)) {
      if (customElements.get(tag)) continue;
      const cls = tag === TAG ? OggStudioCard : class extends OggStudioCard {
        static get variant() {
          return variant;
        }
      };
      customElements.define(tag, cls);
      window.customCards.push({ type: tag, name: variant.name, description: variant.description, preview: true });
    }
  }
})();
