// Part of the OggStudio card. Built into custom_components/oggstudio/frontend/oggstudio-card.js (npm run build).
import { runModeOptions } from '../lib/convert.js';
import { NO_DEVICE, PARTS, TAG, VARIANTS, VERSION, esc } from '../lib/core.js';
import { gpState } from '../lib/gamepad.js';
import { MOODS } from '../lib/moods.js';
import { STROKE_PCT_MIN } from '../lib/stroke.js';
import { STYLES } from './styles.js';

// The card: shared state, the markup and the wiring. Each feature's methods
// live in their own file (stroke, gamepad, video, replay, outputs) and are
// mixed in by ../index.js.
export class OggStudioCard extends HTMLElement {
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
    this.shadowRoot.addEventListener('pointerdown', () => { gpState.owner = this; }, true);
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
    if (this._cast) this._castSync();
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
        if (e.entity_id.startsWith('media_player.')) { (this._mpPlatform = this._mpPlatform || {})[e.entity_id] = e.platform; continue; }
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
${STYLES}
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
            <div class="ctltabs" role="tablist"><button type="button" data-ctl="record">● Record</button><button type="button" data-ctl="replay">▶ Replay</button><button type="button" data-ctl="mood">◎ Mood</button></div>
            <div id="moodbox" hidden>
              <div class="moodgrid">${Object.entries(MOODS).map(([k, m]) => `<button type="button" class="moodbtn" data-mood="${k}"><span>${m.icon}</span>${m.label}</button>`).join('')}</div>
              <div class="rpbar" id="moodbar"><i id="moodfill"></i></div>
              <div class="rpinfo" id="moodinfo"></div>
              <div class="moodrow"><label title="Vibration level, and stroke depth and speed">Strength</label><input id="moodstr" type="range" min="20" max="100" step="5" value="100"><b id="moodstrv">100%</b></div>
              <div class="row" style="margin-top:6px"><button id="moodnext" type="button">🎲 Another</button><button id="moodstop" type="button" class="stop">■ Stop</button></div>
            </div>
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
            <div class="outrow" data-row="0"><select class="outt" aria-label="First device"></select><select class="outm" aria-label="How the first device follows"></select><div class="outai" hidden></div><button class="outtake" type="button" hidden>Take control</button></div>
            <div class="outrow" data-row="1"><select class="outt" aria-label="Second device"></select><select class="outm" aria-label="How the second device follows"></select><div class="outai" hidden></div><button class="outtake" type="button" hidden>Take control</button></div>
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
}
