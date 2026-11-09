/* OggStudio card: record, import, save and replay patterns on Ogg devices.
 * Scripts are funscript JSON ({actions:[{at,pos}]}, pos 0-100 = intensity);
 * a second motor is stored as channels.V1. Share codes are "ogg1:" + base64
 * of gzip(JSON) ("ogg0:" + base64(JSON) where CompressionStream is missing).
 */
(() => {
  const TAG = 'oggstudio-card';
  if (customElements.get(TAG)) return;
  const VERSION = '0.5.2';
  const DEVICE_KEY = 'oggstudio_device';
  const SPEEDS = ['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x'];
  const SAMPLE_MS = 100;
  const LIVE_MS = 300;
  const VIDEO_TICK_MS = 100;
  const VIDEO_OFFSET_KEY = 'oggstudio_video_offset';
  const PARTS = ['record', 'take', 'library', 'video', 'import'];
  // One card class, several dashboard cards: each shows a subset of the parts.
  const VARIANTS = {
    'oggstudio-card': { name: 'OggStudio', sub: 'Record, import, replay and sync to video', parts: PARTS, size: 9,
      description: 'Everything in one card: record, library, video sync and import.' },
    'oggstudio-recorder-card': { name: 'OggStudio Recorder', sub: 'Draw a pattern with your finger and save it', parts: ['record', 'take'], size: 6,
      description: 'Big touch pads to record (or just play live), then save the take.' },
    'oggstudio-player-card': { name: 'OggStudio Player', sub: 'Play saved patterns and import scripts', parts: ['library', 'take', 'import'], size: 5,
      description: 'Pick a saved pattern and play it; paste or load funscripts and share codes.' },
    'oggstudio-video-card': { name: 'OggStudio Video', sub: 'Play a local video with its script, or record one', parts: ['video', 'take'], size: 7,
      description: 'Sync a video on this device with a script, and record a funscript for it.' },
  };
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

  // Stroke scripts (position) -> vibration intensity.
  function toIntensity(actions, mode) {
    const a = (Array.isArray(actions) ? actions : [])
      .filter((x) => x && Number.isFinite(x.at) && Number.isFinite(x.pos))
      .map((x) => ({ at: Math.max(0, Math.round(x.at)), pos: Math.min(100, Math.max(0, x.pos)) }))
      .sort((x, y) => x.at - y.at);
    if (mode !== 'speed' || a.length < 2) return a.map((x) => ({ at: x.at, pos: Math.round(x.pos) }));
    const out = [];
    for (let i = 1; i < a.length; i++) {
      const dt = (a[i].at - a[i - 1].at) / 1000;
      // A full 0-100 stroke in a quarter second = 100%.
      const v = dt > 0 ? Math.min(100, Math.abs(a[i].pos - a[i - 1].pos) / dt / 4) : 0;
      out.push({ at: a[i - 1].at, pos: Math.round(v) });
    }
    out.push({ at: a[a.length - 1].at, pos: 0 });
    return out;
  }

  function normalise(input, mode, inverted) {
    const flip = (acts) => (inverted ? acts.map((x) => ({ at: x.at, pos: 100 - x.pos })) : acts);
    const script = { version: '1.0', inverted: false, range: 100, actions: flip(toIntensity(input.actions, mode)) };
    const v1 = input.channels && (input.channels.V1 || input.channels.v1);
    if (v1 && Array.isArray(v1.actions)) script.channels = { V1: { actions: flip(toIntensity(v1.actions, mode)) } };
    if (!script.actions.length) throw new Error('The script has no actions');
    script.metadata = { creator: 'OggStudio', type: 'vibration', ...(input.metadata && input.metadata.title ? { title: String(input.metadata.title) } : {}) };
    return script;
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
    for (const action of GP_ACTIONS) out[action] = gpStrength(map[action], pad, keys);
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
  function gpBuildMap(learned) {
    const key = (b) => JSON.stringify(b);
    const taken = new Set(Object.values(learned).flat().map(key));
    const map = {};
    for (const action of GP_ACTIONS) {
      const own = learned[action] && learned[action].length ? learned[action] : [];
      // Once anything is learned, default stick axes go: on a pad whose axes
      // rest off-centre or jitter they would fire on their own.
      const defaults = GP_DEFAULT_MAP[action].filter((b) => !taken.has(key(b))
        && (own.length ? b.k !== undefined : !(taken.size && b.a !== undefined)));
      map[action] = [...own, ...defaults];
    }
    return map;
  }

  // Which card section the controller drives: video recording when a video
  // is loaded in this card, otherwise the Record pads.
  function gpTargetFor(parts, hasVideo) {
    if (parts.includes('video') && hasVideo) return 'video';
    if (parts.includes('record')) return 'record';
    return null;
  }
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
      this.shadowRoot.addEventListener('pointerdown', () => { gpOwner = this; }, true);
    }

    static get variant() { return VARIANTS[TAG]; }
    get _variant() { return this.constructor.variant; }
    get _parts() {
      const wanted = this._config && Array.isArray(this._config.sections) ? this._config.sections.filter((p) => PARTS.includes(p)) : [];
      return wanted.length ? wanted : this._variant.parts;
    }

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
          byDevice.set(e.device_id, d);
        }
        this._devices = [...byDevice.values()].filter((d) => d.stop).sort((a, b) => a.name.localeCompare(b.name));
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
          .gp{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;padding:6px 10px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.025)}
          .gp .check{min-height:36px;font-size:12.5px}
          .gp .gpstat{flex:1;min-width:140px;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
          .gp .gpstat b{color:#bef2ff}
          .gp button{min-height:36px;flex:0 0 auto}
          .gplearn{flex-basis:100%;font-size:13px;color:#ffcf8a;font-weight:700}
          .gpraw{flex-basis:100%;font-size:10.5px;color:var(--muted);font-family:monospace;word-break:break-all}
          [hidden],.off{display:none!important}
        </style>
        <ha-card>
          <h2>${esc(this._config.title || this._variant.name)}</h2><div class="sub">${esc(this._variant.sub)} · v${VERSION}</div>
          <label>Device</label><select id="device"></select>
          <div class="gp" id="gp">
            <label class="check"><input id="gpon" type="checkbox"> 🎮 Controller</label>
            <span class="gpstat" id="gpstat"></span>
            <button id="gplearnbtn" type="button">Learn controls</button>
            <div class="gplearn" id="gplearn" hidden></div>
            <div class="gpraw" id="gpraw" hidden></div>
            <div class="row" id="gplearnrow" style="flex-basis:100%" hidden><button id="gpskip" type="button">Skip</button><button id="gpreset" type="button">Use defaults</button><button id="gpcancel" type="button" class="stop">Cancel</button></div>
          </div>
          <section data-part="record">
            <h3>Record</h3>
            <div class="pads" id="pads">
              <div class="pad" id="pad1" role="slider" tabindex="0" aria-label="Motor 1 level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="ticks"></div><div class="fill"></div><span class="lab">Motor 1</span><span class="pct">0%</span></div>
              <div class="pad" id="pad2" role="slider" tabindex="0" aria-label="Motor 2 level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div class="ticks"></div><div class="fill"></div><span class="lab">Motor 2</span><span class="pct">0%</span></div>
            </div>
            <button id="rec" class="rec">● Record</button><div class="val" id="timer" style="text-align:center;margin-top:4px"></div>
            <div class="row" style="margin-top:6px"><label class="check"><input id="live" type="checkbox"> Live pads</label><label class="check"><input id="spring" type="checkbox"> Drop to 0 when released</label></div>
            <div class="hint">Touch a pad and slide up or down: the level follows your finger. While recording, the pads drive the device live; tick "Live pads" to play with them without recording.</div>
          </section>
          <section id="takebox" data-part="take" hidden>
            <h3>Current take</h3><div class="take" id="takeinfo"></div>
            <div class="row"><button id="takeplay">▶ Play now</button><button id="takestop" class="stop">■ Stop</button><button id="takecode">Copy code</button><button id="takediscard">Discard</button></div>
            <label>Save as</label><div class="row"><input id="name" type="text" placeholder="Name"><button id="save" style="flex:0 0 auto">Save</button></div>
          </section>
          <section data-part="library">
            <h3>Library</h3>
            <select id="saved"></select>
            <div class="row" style="margin-top:8px"><select id="speed"></select><label class="check"><input id="loop" type="checkbox"> Loop</label></div>
            <div class="row" style="margin-top:8px"><button id="play">▶ Play</button><button id="stop" class="stop">■ Stop</button><button id="code">Copy code</button><button id="delete">Delete</button></div>
          </section>
          <section id="videobox" data-part="video">
            <h3>Video sync</h3>
            <div class="hint" style="margin-top:0">The video plays from this phone or computer only. It is never uploaded to Home Assistant.</div>
            <label>Video</label><input id="vfile" type="file" accept="video/*">
            <label>Script</label><select id="vsrc"></select>
            <div id="vfilebox"><input id="vscriptfile" type="file" accept=".funscript,.json,application/json" multiple style="margin-top:6px">
            <label>Script type</label>
            <select id="vmode"><option value="speed">Stroke script: movement speed → intensity</option><option value="position">Vibration script: position → intensity</option></select></div>
            <video id="video" controls playsinline preload="metadata" hidden></video>
            <div class="hbar" id="hb1" role="slider" tabindex="0" aria-label="Motor 1 level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fill"></div><span class="lab">Motor 1</span><span class="pct">0%</span></div>
            <div class="hbar m2" id="hb2" role="slider" tabindex="0" aria-label="Motor 2 level" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><div class="fill"></div><span class="lab">Motor 2</span><span class="pct">0%</span></div>
            <div class="vrecrow"><button id="vrec" class="vrec" type="button">● Rec</button><label class="check"><input id="vspring" type="checkbox" checked> Drop to 0 on release</label><span class="vrecinfo" id="vrecinfo"></span></div>
            <div class="row" id="vrecdone" style="margin-top:6px" hidden><button id="vrecuse">Use as take</button><button id="vrecdl">Download .funscript</button><button id="vrecclear" class="stop">Clear</button></div>
            <div class="vstat" id="vstat"></div>
            <div class="row" style="margin-top:8px"><button id="vgo" class="go">▶ Go</button><button id="vstop" class="stop" style="flex:0 0 96px">■ Stop</button></div>
            <label>Sync offset <span id="voffv"></span></label>
            <input id="voff" type="range" min="-1000" max="1000" step="25" value="150">
            <div class="hint">Positive values send each moment slightly early to make up for Bluetooth delay. Pause, seek and playback speed all stay in sync.</div>
            <div class="hint">To make a script for this video: press ● Rec, play the video and drag the bars left and right. You can pause, scrub back and record a section again; the newer pass replaces it.</div>
          </section>
          <section data-part="import">
            <h3>Import</h3>
            <textarea id="paste" placeholder="Paste a funscript, an ogg1: code, or JSON"></textarea>
            <div class="row" style="margin-top:6px"><input id="files" type="file" accept=".funscript,.json,application/json" multiple></div>
            <label>Convert stroke scripts using</label>
            <select id="mode"><option value="position">Position → intensity (vibration scripts)</option><option value="speed">Movement speed → intensity (stroke/video scripts)</option></select>
            <label class="check" style="margin-top:6px"><input id="invert" type="checkbox"> Inverted</label>
            <div class="row" style="margin-top:8px"><button id="load">Load as current take</button></div>
            <div class="hint">Pick two files to give a two-motor device one track per motor (first file = motor 1).</div>
            <textarea id="codeout" hidden readonly></textarea>
          </section>
          <div class="toast" id="toast"></div>
        </ha-card>`;
      const $ = (id) => this.shadowRoot.getElementById(id);
      this._el = $;
      const parts = this._parts;
      for (const sec of this.shadowRoot.querySelectorAll('[data-part]')) {
        sec.classList.toggle('off', !parts.includes(sec.dataset.part));
        sec.style.order = String(parts.indexOf(sec.dataset.part) + 1);   // sections follow the card's own order
      }
      $('device').addEventListener('change', () => {
        this._deviceId = $('device').value;
        this._rememberDevice(this._device);
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
      $('takediscard').addEventListener('click', () => { this._take = null; this._update(); });
      $('save').addEventListener('click', () => this._save());
      $('play').addEventListener('click', () => this._playSaved());
      $('stop').addEventListener('click', () => this._stop());
      $('code').addEventListener('click', () => this._copySaved());
      $('delete').addEventListener('click', () => this._delete());
      $('saved').addEventListener('change', () => this._hass.callService('select', 'select_option', { entity_id: this._studio.saved, option: $('saved').value }));
      $('speed').addEventListener('change', () => this._hass.callService('select', 'select_option', { entity_id: this._studio.speed, option: $('speed').value }));
      $('load').addEventListener('click', () => this._import());
      this._bindVideo();
      this._bindGamepad();
      this._update();
    }

    // ---------------------------------------------------------- game controller
    _bindGamepad() {
      const $ = this._el;
      const parts = this._parts;
      $('gp').hidden = !(parts.includes('record') || parts.includes('video'));
      this._gpLearning = null;
      this._gpStatusHtml = null;
      const load = (key, fallback) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (_) { return fallback; } };
      const map = load(GP_MAP_KEY, null);
      this._gpMap = map && typeof map === 'object' ? gpBuildMap(map) : { ...GP_DEFAULT_MAP };
      const speed = Number(load(GP_SPEED_KEY, GP_SPEED_DEFAULT));
      this._gpSpeed = Number.isInteger(speed) && speed >= 0 && speed < GP_SPEEDS.length ? speed : GP_SPEED_DEFAULT;
      $('gpon').checked = load(GP_ON_KEY, false) === true;
      $('gpon').addEventListener('change', () => { this._gpSave(GP_ON_KEY, $('gpon').checked); gpOwner = this; this._gpRun(); this._gpStatus(); });
      $('gplearnbtn').addEventListener('click', () => this._gpLearnStart());
      $('gpskip').addEventListener('click', () => this._gpLearnSkip());
      $('gpreset').addEventListener('click', () => { this._gpSave(GP_MAP_KEY, null); this._gpMap = { ...GP_DEFAULT_MAP }; this._gpLearnEnd('Controller: default controls restored.'); });
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
          if (!GP_ACTIONS.some((a) => (this._gpMap[a] || []).some((b) => b.k !== undefined && n.includes(b.k)))) return;
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
      const dual = Boolean(this._device && this._device.dual);
      if (!dual) return [0];
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
      if (!(this._device && this._device.dual)) return;
      this._gpMotor = (this._gpMotor + 1) % 3;
      this._gpFloat = [null, null];
    }

    _gpRec() {
      const $ = this._el;
      const target = this._gpTarget();
      if (target === 'video') {
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
      let html = '';
      if (this._gpLearning) html = '';
      else if (!$('gpon').checked) html = 'Up/down = level, left/right = speed, A = record';
      else {
        const bits = [`Speed <b>${this._gpSpeed + 1}/${GP_SPEEDS.length}</b> (${GP_SPEEDS[this._gpSpeed]}%/s)`];
        if (this._device && this._device.dual) bits.push(['Motor 1', 'Motor 2', 'Both motors'][this._gpMotor]);
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
      this._gpLearning = { phase: 'wake', learned: {}, step: 0, samples: [], cal: null, recBtn: -1, recKey: null, wait: true, last: '' };
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
        hold: `${L.step + 1}/${GP_HOLD_ACTIONS.length}: hold ${GP_LABELS[GP_HOLD_ACTIONS[L.step]].toUpperCase()}, then press Record (${recName}) to confirm. Nothing held, or Skip = keep the default.`,
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
        this._gpLog(`${GP_HOLD_ACTIONS[L.step]} confirmed -> ${gpDescribe(bind)} · ${gpRaw(pad)}`);
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
      const action = GP_HOLD_ACTIONS[L.step];
      if (bind) {
        const same = JSON.stringify(bind);
        for (const a of Object.keys(L.learned)) L.learned[a] = L.learned[a].filter((b) => JSON.stringify(b) !== same);
        L.learned[action] = [bind];
      }
      L.last = `${GP_LABELS[action]} = ${gpDescribe(bind)}`;
      L.wait = true;
      L.step += 1;
      if (L.step < GP_HOLD_ACTIONS.length) { this._gpLearnShow(); return; }
      this._gpSave(GP_MAP_KEY, L.learned);
      this._gpMap = gpBuildMap(L.learned);
      this._gpLog(`learn finished: ${JSON.stringify(L.learned)}`);
      this._gpLearnEnd('Controller: controls saved for this browser.');
    }

    _gpLearnEnd(message) {
      const $ = this._el;
      this._gpLearning = null;
      $('gplearn').hidden = true; $('gplearnrow').hidden = true; $('gpraw').hidden = true; $('gplearnbtn').hidden = false;
      // Treat everything as held so nothing fires until it is released.
      this._gpPrev = Object.fromEntries(GP_ACTIONS.map((a) => [a, 1]));
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
      $('vmode').addEventListener('change', () => this._loadVideoScript());
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
      try {
        if (fromFile) {
          const files = [...$('vscriptfile').files];
          if (!files.length) { this._vscript = null; this._videoStatus(); return; }
          const parsed = await Promise.all(files.slice(0, 2).map(async (f) => decodeText(await f.text())));
          const first = parsed[0];
          if (parsed[1]) first.channels = { V1: { actions: parsed[1].actions || [] } };
          this._vscript = normalise(first, $('vmode').value, Boolean(first.inverted));
          this._vscriptName = files[0].name;
        } else {
          this._vscript = await this._getSaved($('vsrc').value);   // library scripts are already intensity
          this._vscriptName = $('vsrc').value;
        }
        this._videoSend(true);
      } catch (e) {
        this._vscript = null;
        this._toast('Could not load the script: ' + (e.message || e));
      }
      this._videoStatus();
    }

    _videoLevels() {
      const video = this._el('video');
      const dual = Boolean(this._device && this._device.dual);
      if (this._vrec) return dual ? [this._hvals[0] / 100, this._hvals[1] / 100] : [this._hvals[0] / 100];
      const s = this._vscript;
      if (!s) return null;
      const ms = video.currentTime * 1000 + Number(this._el('voff').value || 0);
      const main = sampleAt(s.actions, ms) / 100;
      const levels = [main];
      if (this._device && this._device.dual) {
        const v1 = s.channels && s.channels.V1 && s.channels.V1.actions;
        levels.push(v1 && v1.length ? sampleAt(v1, ms) / 100 : main);
      }
      return levels.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100);
    }

    _videoSend(force) {
      const video = this._el && this._el('video');
      if (!this._vsyncTimer || !video || video.paused) { this._videoStatus(); return; }
      const dev = this._device;
      if (this._vrec) this._vrecSample();
      const levels = this._videoLevels();
      if (!dev || !levels) return;
      const now = performance.now();
      const changed = !this._vlast || levels.some((v, i) => Math.abs(v - (this._vlast[i] ?? -1)) >= 0.01);
      // Refresh unchanged levels too: ogg.live stops by itself if refreshes stop.
      if (force || changed || now - this._vsentAt > 500) {
        this._vlast = levels;
        this._vsentAt = now;
        this._sendLive(dev, levels, 1.5);
      }
      this._videoStatus(levels);
    }

    _videoRun() {
      if (this._vsyncTimer || !(this._vscript || this._vrec)) return;
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
      if (this._device) this._quietStop(this._device);
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
      if (this._vrec) this._videoSend(false);
    }

    _bindHBar(bar, index) {
      let active = false;
      const fromEvent = (event) => {
        const rect = bar.getBoundingClientRect();
        this._setHBar(index, ((event.clientX - rect.left) / rect.width) * 100);
      };
      bar.addEventListener('pointerdown', (event) => {
        if (!this._vrec) { this._toast('Press ● Rec first to record with the bars'); return; }
        event.preventDefault();
        active = true;
        bar.classList.add('active');
        bar.setPointerCapture?.(event.pointerId);
        fromEvent(event);
      });
      bar.addEventListener('pointermove', (event) => { if (active) fromEvent(event); });
      const release = () => {
        if (!active) return;
        active = false;
        bar.classList.remove('active');
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
      const dual = Boolean(this._device && this._device.dual);
      if (!this._vcur) this._vcur = [[], []];
      for (const i of dual ? [0, 1] : [0]) {
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
      if (main[main.length - 1].pos !== 0) main.push({ at: end + 1, pos: 0 });
      const script = { version: '1.0', inverted: false, range: 100, actions: main,
        metadata: { creator: 'OggStudio', type: 'vibration', ...(this._vname ? { title: this._vname } : {}) } };
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
      this._vscript = script;          // replay it with the video straight away
      this._el('name').value = this._vname || '';
      this._vrecReset();
      this._toast(`Recorded ${fmt(duration(script))}. It is now the current take (save it below) and plays with this video.`);
      this._update();
    }

    _vrecDownload() {
      const script = this._vrecScript();
      if (!script) return;
      const blob = new Blob([JSON.stringify(script)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${this._vname || 'oggstudio'}.funscript`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
      if (!this._device) { this._toast('No Ogg device to play on'); return; }
      try {
        if (video.ended) video.currentTime = 0;
        await video.play();          // the play event starts the sync
      } catch (e) { this._toast('The browser would not start the video: ' + (e.message || e)); }
    }

    _videoStatus(levels) {
      if (!this._el) return;
      const $ = this._el;
      const video = $('video');
      const dual = Boolean(this._device && this._device.dual);
      $('hb2').hidden = !dual;
      // Outside recording the bars mirror what the script is sending.
      if (levels && !this._vrec) {
        this._showHBar(0, (levels[0] || 0) * 100);
        this._showHBar(1, (levels[1] ?? levels[0] ?? 0) * 100);
      }
      const parts = [];
      if (this._device && !this._online(this._device)) parts.push(`⚠ ${this._device.name} not connected`);
      if (this._vscript) parts.push(`Script ${fmt(duration(this._vscript))}`);
      if (this._vurl && Number.isFinite(video.duration)) parts.push(`video ${fmt(video.duration * 1000)}`);
      if (this._vsyncTimer && levels) parts.push(`now ${levels.map((v) => Math.round(v * 100) + '%').join(' / ')}`);
      else if (this._vurl && this._vscript) parts.push('ready');
      $('vstat').textContent = parts.join(' · ');
      $('vgo').disabled = !(this._vurl && (this._vscript || this._vrec) && this._device);
      this._vrecInfo();
    }

    get _device() { return this._devices.find((d) => d.id === this._deviceId) || this._devices[0]; }

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
      if (this._deviceId && known(this._deviceId)) return this._deviceId;
      const saved = this._remembered;
      const savedDev = saved && (known(saved.id) || list.find((d) => d.name === saved.name));
      if (savedDev) return savedDev.id;
      const wanted = this._config && this._config.device;
      const match = wanted && list.find((d) => d.stop === wanted || d.name === wanted);
      if (match) return match.id;
      const online = list.find((d) => this._online(d));
      return (online || list[0] || {}).id;
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
        sel.replaceChildren(...ordered.map((d) => new Option(this._online(d) ? d.name : `${d.name} (offline)`, d.id)));
        sel.dataset.key = key;
        // Wait for the remembered choice before falling back to a default.
        if (this._rememberedLoaded) this._deviceId = this._pickDevice();
      }
      if (this._deviceId) sel.value = this._deviceId;
      const dev = this._device;
      const online = dev && (!dev.connected || this._hass.states[dev.connected]?.state === 'on');
      const dual = Boolean(dev && dev.dual);
      $('pad2').hidden = !dual;
      $('pads').classList.toggle('dual', dual);
      for (const id of ['rec', 'takeplay', 'play']) $(id).disabled = !online;
      $('rec').textContent = this._recording ? '■ Stop recording' : '● Record';
      $('rec').classList.toggle('on', this._recording);
      $('takebox').hidden = !this._take;
      if (this._take) {
        $('takeinfo').textContent = `${fmt(duration(this._take))} · ${this._take.channels ? 2 : 1} motor${this._take.channels ? 's' : ''} · ${this._take.actions.length} points · not saved`;
      }
      const saved = this._studio && this._hass.states[this._studio.saved];
      const opts = (saved && saved.attributes.options) || [];
      const savedKey = JSON.stringify(opts);
      if ($('saved').dataset.key !== savedKey) { $('saved').replaceChildren(...opts.map((o) => new Option(o, o))); $('saved').dataset.key = savedKey; }
      if (saved && this.shadowRoot.activeElement !== $('saved')) $('saved').value = saved.state;
      const hasSaved = saved && saved.attributes.scripts && Object.keys(saved.attributes.scripts).length > 0;
      for (const id of ['code', 'delete']) $(id).disabled = !hasSaved;
      $('play').disabled = !online || !hasSaved;
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
      pad.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        active = true;
        pad.classList.add('active');
        pad.setPointerCapture?.(event.pointerId);
        fromEvent(event);
      });
      pad.addEventListener('pointermove', (event) => { if (active) fromEvent(event); });
      const release = () => {
        if (!active) return;
        active = false;
        pad.classList.remove('active');
        if (this._el('spring').checked) this._setPad(index, 0);
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

    _levels() {
      const $ = this._el;
      const levels = [this._vals[0] / 100];
      if (this._device && this._device.dual) levels.push(this._vals[1] / 100);
      return levels;
    }

    _setLive(on) {
      this._live = on;
      clearInterval(this._liveTimer);
      this._liveTimer = null;
      if (on || this._recording) {
        const send = () => {
          const dev = this._device;
          if (!dev) return;
          this._sendLive(dev, this._levels(), 1.0);
        };
        send();
        this._liveTimer = setInterval(send, LIVE_MS);
      } else if (this._device) {
        this._quietStop(this._device);
      }
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
      if (this._device && this._device.dual && this._samples[1].length) take.channels = { V1: { actions: this._samples[1] } };
      this._take = take.actions.length ? take : null;
      $('timer').textContent = '';
      this._setPad(0, 0); this._setPad(1, 0);
      this._update();
    }

    async _play(script) {
      if (!script || !this._device) return;
      try {
        await this._hass.callService('oggstudio', 'play', { entity_id: this._device.stop, script, speed: this._el('speed').value, loop: this._el('loop').checked });
      } catch (e) { this._toast(e.message || String(e)); }
    }

    async _playSaved() {
      if (!this._device) return;
      try {
        await this._hass.callService('oggstudio', 'play', { entity_id: this._device.stop, name: this._el('saved').value, speed: this._el('speed').value, loop: this._el('loop').checked });
      } catch (e) { this._toast(e.message || String(e)); }
    }

    async _stop() {
      if (this._device) await this._hass.callService('oggstudio', 'stop', { entity_id: this._device.stop }).catch(() => {});
    }

    async _save() {
      const name = this._el('name').value.trim();
      if (!name) { this._toast('Type a name first'); return; }
      try {
        await this._hass.callService('oggstudio', 'save', { name, script: this._take });
        this._toast(`Saved "${name}"`);
        this._take = null;
        this._el('name').value = '';
        this._update();
      } catch (e) { this._toast(e.message || String(e)); }
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
          if (!first.metadata || !first.metadata.title) first.metadata = { ...(first.metadata || {}), title: files[0].name.replace(/\.(funscript|json)$/i, '') };
          script = normalise(first, mode, inverted);
        } else if ($('paste').value.trim()) {
          script = normalise(await decodeText($('paste').value), mode, inverted);
        } else { this._toast('Paste a script or choose a file first'); return; }
        this._take = script;
        $('name').value = (script.metadata && script.metadata.title) || '';
        $('paste').value = ''; $('files').value = '';
        this._toast(`Loaded ${fmt(duration(script))} script. Play it now or save it.`);
        this._update();
      } catch (e) { this._toast('Could not import: ' + (e.message || e)); }
    }

    _fillVideoScripts() {
      const sel = this._el('vsrc');
      const savedState = this._studio && this._studio.saved && this._hass.states[this._studio.saved];
      const names = ((savedState && savedState.attributes.options) || []).filter((n) => n && !/^\(.*\)$/.test(n));
      const key = JSON.stringify(names);
      if (sel.dataset.key === key) return;
      const current = sel.value;
      sel.replaceChildren(new Option('From a file on this device…', ''), ...names.map((n) => new Option(`Library: ${n}`, n)));
      sel.dataset.key = key;
      if ([...sel.options].some((o) => o.value === current)) sel.value = current;
      this._el('vfilebox').hidden = sel.value !== '';
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
      this._gpDetach();
      if (this._vsyncTimer) this._videoHalt();
      if (this._vurl) { URL.revokeObjectURL(this._vurl); this._vurl = null; }
      if (this._recording || this._live) this._quietStop(this._device);
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
