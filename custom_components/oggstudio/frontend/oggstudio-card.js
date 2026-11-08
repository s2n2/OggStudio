/* OggStudio card: record, import, save and replay patterns on Ogg devices.
 * Scripts are funscript JSON ({actions:[{at,pos}]}, pos 0-100 = intensity);
 * a second motor is stored as channels.V1. Share codes are "ogg1:" + base64
 * of gzip(JSON) ("ogg0:" + base64(JSON) where CompressionStream is missing).
 */
(() => {
  const TAG = 'oggstudio-card';
  if (customElements.get(TAG)) return;
  const VERSION = '0.1.0';
  const SPEEDS = ['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x'];
  const SAMPLE_MS = 100;
  const LIVE_MS = 300;

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

  const duration = (s) => Math.max(
    s.actions.length ? s.actions[s.actions.length - 1].at : 0,
    s.channels && s.channels.V1.actions.length ? s.channels.V1.actions[s.channels.V1.actions.length - 1].at : 0);
  const fmt = (ms) => `${(ms / 1000).toFixed(1)} s`;

  class OggStudioCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._devices = [];
      this._take = null;
      this._recording = false;
      this._live = false;
      this._samples = null;
    }

    setConfig(config) { this._config = config || {}; this._render(); }
    getCardSize() { return 9; }
    static getStubConfig() { return {}; }

    set hass(hass) {
      this._hass = hass;
      if (!this._registryLoaded) { this._registryLoaded = true; this._loadRegistry(); }
      this._update();
    }

    async _loadRegistry() {
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
          ha-card{background:#0a1122;color:var(--ink);border-radius:22px;border:1px solid #293552;padding:16px;font-family:inherit}
          h2{margin:0 0 2px;font-size:20px;letter-spacing:-.02em} .sub{color:var(--muted);font-size:12px;margin-bottom:12px}
          section{border:1px solid var(--line);border-radius:16px;padding:12px;margin-top:10px;background:rgba(255,255,255,.035)}
          h3{margin:0 0 8px;font-size:13px;color:#cdd6f6;letter-spacing:.01em}
          label{display:block;font-size:11px;color:var(--muted);margin:6px 0 3px}
          select,input[type=text],textarea{width:100%;box-sizing:border-box;background:#18233d;color:var(--ink);border:1px solid #33415f;border-radius:10px;padding:8px;font:inherit;font-size:13px}
          textarea{min-height:60px;resize:vertical;font-family:monospace;font-size:11px}
          .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap} .row > *{flex:1}
          button{border:1px solid rgba(118,200,239,.35);background:#24395a;color:#bef2ff;border-radius:11px;min-height:38px;padding:0 12px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
          button:disabled{opacity:.4;cursor:default}
          button.rec{background:#5a2433;border-color:rgba(255,110,130,.5);color:#ffd2da}
          button.rec.on{background:linear-gradient(110deg,#ff5c7a,#ff8aa0);color:#2a0710}
          button.stop{background:rgba(246,104,121,.08);border-color:rgba(246,104,121,.3);color:#e9adb7}
          .slider{display:grid;grid-template-columns:60px 1fr 42px;gap:8px;align-items:center;margin:6px 0}
          input[type=range]{width:100%;accent-color:#67e0c8;height:28px}
          .val{font-variant-numeric:tabular-nums;text-align:right;color:#cdd6f6;font-size:12px}
          .take{font-size:12px;color:#cdd6f6;margin-bottom:6px}
          .hint{font-size:11px;color:var(--muted);margin-top:6px}
          .toast{min-height:16px;font-size:12px;color:#ffcf8a;margin-top:8px}
          .check{display:flex;gap:6px;align-items:center;font-size:12px;color:#cdd6f6;flex:0 0 auto}
          [hidden]{display:none!important}
        </style>
        <ha-card>
          <h2>OggStudio</h2><div class="sub">Record, import and replay patterns · v${VERSION}</div>
          <label>Device</label><select id="device"></select>
          <section>
            <h3>Record</h3>
            <div class="slider"><span>Motor 1</span><input id="m1" type="range" min="0" max="100" value="0"><span class="val" id="v1">0%</span></div>
            <div class="slider" id="m2row" hidden><span>Motor 2</span><input id="m2" type="range" min="0" max="100" value="0"><span class="val" id="v2">0%</span></div>
            <div class="row"><button id="rec" class="rec">● Record</button><label class="check"><input id="live" type="checkbox"> Live sliders</label><span class="val" id="timer"></span></div>
            <div class="hint">While recording, the sliders drive the device live. Tick "Live sliders" to play with them without recording.</div>
          </section>
          <section id="takebox" hidden>
            <h3>Current take</h3><div class="take" id="takeinfo"></div>
            <div class="row"><button id="takeplay">▶ Play now</button><button id="takestop" class="stop">■ Stop</button><button id="takecode">Copy code</button><button id="takediscard">Discard</button></div>
            <label>Save as</label><div class="row"><input id="name" type="text" placeholder="Name"><button id="save" style="flex:0 0 auto">Save</button></div>
          </section>
          <section>
            <h3>Library</h3>
            <select id="saved"></select>
            <div class="row" style="margin-top:8px"><select id="speed"></select><label class="check"><input id="loop" type="checkbox"> Loop</label></div>
            <div class="row" style="margin-top:8px"><button id="play">▶ Play</button><button id="stop" class="stop">■ Stop</button><button id="code">Copy code</button><button id="delete">Delete</button></div>
          </section>
          <section>
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
      $('device').addEventListener('change', () => { this._deviceId = $('device').value; this._update(); });
      for (const n of ['1', '2']) $('m' + n).addEventListener('input', () => { $('v' + n).textContent = $('m' + n).value + '%'; });
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
      this._update();
    }

    get _device() { return this._devices.find((d) => d.id === this._deviceId) || this._devices[0]; }

    _update() {
      if (!this._el || !this._hass) return;
      const $ = this._el;
      const sel = $('device');
      const key = JSON.stringify(this._devices.map((d) => [d.id, d.name]));
      if (sel.dataset.key !== key) {
        sel.replaceChildren(...this._devices.map((d) => new Option(d.name, d.id)));
        sel.dataset.key = key;
        const wanted = this._config && this._config.device;
        const match = wanted && this._devices.find((d) => d.stop === wanted || d.name === wanted);
        this._deviceId = this._deviceId || (match ? match.id : this._devices[0] && this._devices[0].id);
      }
      if (this._deviceId) sel.value = this._deviceId;
      const dev = this._device;
      const online = dev && (!dev.connected || this._hass.states[dev.connected]?.state === 'on');
      $('m2row').hidden = !(dev && dev.dual);
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

    _levels() {
      const $ = this._el;
      const levels = [Number($('m1').value) / 100];
      if (this._device && this._device.dual) levels.push(Number($('m2').value) / 100);
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
          this._hass.callService('ogg', 'live', { entity_id: dev.stop, levels: this._levels(), seconds: 1.0 }).catch((e) => this._toast(e.message || String(e)));
        };
        send();
        this._liveTimer = setInterval(send, LIVE_MS);
      } else if (this._device) {
        this._hass.callService('ogg', 'stop_script', { entity_id: this._device.stop }).catch(() => {});
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
      for (const n of ['1', '2']) { $('m' + n).value = 0; $('v' + n).textContent = '0%'; }
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

    _toast(text) { if (this._el) this._el('toast').textContent = text; }

    disconnectedCallback() {
      clearInterval(this._liveTimer); clearInterval(this._sampleTimer);
      if (this._recording || this._live) this._hass?.callService('ogg', 'stop_script', { entity_id: this._device?.stop }).catch(() => {});
    }
  }

  customElements.define(TAG, OggStudioCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: TAG, name: 'OggStudio', description: 'Record, import and replay patterns on Ogg devices.' });
})();
