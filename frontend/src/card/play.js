// Part of the OggStudio card. Built into custom_components/oggstudio/frontend/oggstudio-card.js (npm run build).
import { FOLLOW_AI } from '../lib/ai.js';
import { liveIntensity } from '../lib/convert.js';
import { SAMPLE_MS, duration, fmt } from '../lib/core.js';
import { FOLLOW_STROKER, parseTarget } from '../lib/outputs.js';
import { PATTERNS, PATTERNS_DUAL, PATTERN_RANDOM, RandomProgram, patternDual, patternLevel, patternPeriod } from '../lib/patterns.js';
import { STROKE_LIMIT_KEY, STROKE_PCT_MIN, strokeStep, strokeVel } from '../lib/stroke.js';

const PATTERN_KEY = 'oggstudio_pattern';
const VSTROKE_KEY = 'oggstudio_video_stroke';
const VVIBE_KEY = 'oggstudio_video_vibe';
const PATTERN_HINT = 'Ogg\'s patterns, played from here: they show on the pads, stay inside your limits and can be recorded.';

// Methods mixed into OggStudioCard: the Play card's own parts. One Record
// button for every mode, Ogg's patterns, and the video's side controls.
export class PlayPart {
  get _simple() { return Boolean(this._variant.simple); }
  get _togetherOnly() { return Boolean(this._variant.together); }

  _bindPlay() {
    const $ = this._el;
    $('urec').addEventListener('click', () => this._urecToggle());
    // Patterns.
    for (const b of this.shadowRoot.querySelectorAll('.ptbtn')) b.addEventListener('click', () => this._ptStart(b.dataset.pt));
    let kept = {};
    try { kept = JSON.parse(localStorage.getItem(PATTERN_KEY) || '{}') || {}; } catch (_) { /* private mode */ }
    if (Number.isFinite(kept.speed)) $('ptspeed').value = String(kept.speed);
    if (Number.isFinite(kept.str)) $('ptstr').value = String(kept.str);
    const keep = () => {
      try { localStorage.setItem(PATTERN_KEY, JSON.stringify({ speed: Number($('ptspeed').value), str: Number($('ptstr').value) })); } catch (_) { /* private mode */ }
      this._ptShow();
    };
    $('ptspeed').addEventListener('input', keep);
    $('ptstr').addEventListener('input', keep);
    $('ptstop').addEventListener('click', () => this._ptStop());
    // The video's side controls press the full controls they stand for.
    const video = $('video');
    $('vsfile').addEventListener('click', () => $('vfile').click());
    $('vempty').addEventListener('click', () => $('vfile').click());
    $('vsscript').addEventListener('click', () => { $('vscriptbox').classList.toggle('open'); this._vsideShow(); });
    $('vsplay').addEventListener('click', () => { if (video.paused) this._videoGo(); else video.pause(); });
    $('vscast').addEventListener('click', () => $('vcast').click());
    $('vsaud').addEventListener('click', () => this._vaSet(!this._vaudio));
    $('vsoff').addEventListener('click', () => { $('voffbox').classList.toggle('open'); this._vsideShow(); });
    $('vsfull').addEventListener('click', () => this._vFull());
    this._bindVlim();
    if (this._simple) {
      // Full screen is this card's own, so the slider can sit over the video.
      video.setAttribute('controlslist', 'nofullscreen');
      video.addEventListener('dblclick', (e) => { e.preventDefault(); this._vFull(); });
    }
    const onFull = () => this._vFullShow();
    document.addEventListener('fullscreenchange', onFull);
    document.addEventListener('webkitfullscreenchange', onFull);
    for (const type of ['play', 'pause', 'ended', 'emptied', 'loadedmetadata']) video.addEventListener(type, () => this._vsideShow());
    if (this._simple) {
      // Here the video's sound is switched on beside the video, not picked as a source.
      const opt = [...$('ausrc').options].find((o) => o.value === 'video');
      if (opt) { opt.hidden = true; opt.disabled = true; }
      if ($('ausrc').value === 'video') $('ausrc').value = 'mic';
      this._auShow();
    }
    this._ptShow();
    this._vsideShow();
    this._urecShow();
  }

  // ---------------------------------------------------------- one Record button
  get _urecOn() { return Boolean(this._recording || this._stRecording || this._tap); }

  // Manual records the pads or the stroke bar as they are worked. Every
  // other mode records what it plays: what the pads or the bar show.
  _urecToggle() {
    if (this._urecOn) { this._urecStop(); return; }
    if (this._ctl !== 'record') this._tapStart();
    else if (this._strokeKind) this._stStart();
    else this._startRecording();
    this._urecShow();
  }

  _urecStop() {
    if (this._recording) this._stopRecording();
    if (this._stRecording) this._stStop();
    if (this._tap) this._tapStop();
    this._update();
  }

  _urecTime() {
    const now = performance.now();
    if (this._recording) return now - this._t0;
    if (this._stRecording) return now - this._st0;
    const tap = this._tap;
    if (!tap) return 0;
    return tap.video ? this._el('video').currentTime * 1000 : now - tap.t0;
  }

  _urecShow() {
    if (!this._el || !this._simple) return;
    const $ = this._el;
    const on = this._urecOn;
    $('urec').textContent = on ? '■ Stop recording' : '● Record';
    $('urec').classList.toggle('on', on);
    $('utimer').textContent = on ? fmt(this._urecTime()) : '';
    // The take shows from the moment recording starts.
    $('takebox').hidden = !this._take && !on;
    $('takebox').classList.toggle('busy', on);
    if (on) {
      const tap = this._tap;
      const what = tap && tap.video ? (this._el('video').paused ? 'play the video to record against it' : 'following the video') : 'recording';
      $('takeinfo').textContent = `● ${fmt(this._urecTime())} · ${what}`;
    }
    if (on && !this._urecTimer) {
      this._urecTimer = setInterval(() => {
        if (this._urecOn) { this._urecShow(); return; }
        clearInterval(this._urecTimer); this._urecTimer = null;
        this._update();        // it was stopped from elsewhere
      }, 250);
    }
    if (!on && this._urecTimer && !this.isConnected) { clearInterval(this._urecTimer); this._urecTimer = null; }
  }

  // Record what plays. In Video mode with a video loaded, against the
  // video's clock: pause and it waits, go back and the new pass replaces
  // what came after.
  _tapStart() {
    if (this._tap) return;
    const video = this._ctl === 'video' && Boolean(this._vurl);
    this._tap = { video, stroke: this._strokeKind, t0: performance.now(), tracks: [[], []], last: [null, null], seen: [null, null], lastT: -1, end: 0 };
    if (video) {
      this._hvals[0] = 0;
      this._showHBar(0, 0);
      if (!this._el('video').paused) this._videoRun();
      this._toast(this._vscript || this._au ? 'Recording what plays with the video.' : 'Recording: play the video and drag the slider.');
    } else this._toast('Recording what plays.');
    clearInterval(this._tapTimer);
    this._tapTimer = setInterval(() => this._tapSample(), SAMPLE_MS);
    this._tapSample();
  }

  _tapSample() {
    const tap = this._tap;
    if (!tap || !this._el) return;
    let t;
    if (tap.video) {
      const video = this._el('video');
      if (video.paused || video.seeking) return;
      t = Math.round(video.currentTime * 1000);
      if (t < tap.lastT) {
        tap.tracks = tap.tracks.map((acts) => acts.filter((p) => p.at < t));
        tap.last = [null, null]; tap.seen = [null, null];
      }
      tap.lastT = t;
    } else t = Math.round(performance.now() - tap.t0);
    const vals = tap.stroke ? [Math.round(this._st.pos)] : this._levels().map((v) => Math.round(v * 100));
    vals.forEach((pos, i) => {
      const acts = tap.tracks[i];
      if (pos !== tap.last[i]) {
        // It held its level until the last look: mark that, so the change is not a slow slide.
        const held = tap.seen[i];
        const prev = acts[acts.length - 1];
        if (prev && held !== null && held > prev.at && held < t) acts.push({ at: held, pos: prev.pos });
        acts.push({ at: t, pos });
        tap.last[i] = pos;
      }
      tap.seen[i] = t;
    });
    tap.end = t;
  }

  _tapStop() {
    const tap = this._tap;
    if (!tap) return;
    this._tap = null;
    clearInterval(this._tapTimer);
    this._tapTimer = null;
    const [first, second] = tap.tracks;
    for (const acts of tap.tracks) {
      const prev = acts[acts.length - 1];
      if (!prev) continue;
      if (tap.end > prev.at) acts.push({ at: tap.end, pos: prev.pos });
      if (!tap.stroke) acts.push({ at: tap.end + 1, pos: 0 });
    }
    const something = tap.stroke ? first.some((p) => p.pos !== first[0].pos) : tap.tracks.some((acts) => acts.some((p) => p.pos > 0));
    if (first.length < 2 || tap.end - first[0].at < 200 || !something) this._toast('Nothing recorded.');
    else {
      const take = { version: '1.0', inverted: false, range: 100, actions: first, metadata: { creator: 'OggStudio', type: tap.stroke ? 'stroke' : 'vibration' } };
      if (!tap.stroke && second.some((p) => p.pos > 0)) take.channels = { V1: { actions: second } };
      if (tap.video && this._vname) take.metadata.title = this._vname;
      this._take = take;
      this._toast(tap.video
        ? `Recorded ${fmt(duration(take))} against the video. To play it back with the video, choose "Current take" under 📂.`
        : `Recorded ${fmt(duration(take))}. Save it below.`);
    }
    if (tap.video && !this._vscript && this._vsyncTimer) this._videoHalt();
    this._update();
  }

  // ---------------------------------------------------------- patterns
  _ptStart(key) {
    if (this._pt && this._pt.key === key) { this._ptStop(); return; }
    this._ptStop();
    this._plOff();
    this._rpStop();
    this._auStop();
    const video = this._el('video');
    if (video && !video.paused) video.pause();     // one thing drives the devices at a time
    const now = performance.now();
    this._pt = { key, phase: 0, last: now, outAt: 0, prev: null,
      prog: key === PATTERN_RANDOM ? new RandomProgram(this._twoPads && !this._strokeKind ? 2 : 1) : null };
    this._ptTimer = setInterval(() => this._ptTick(), 50);
    this._ptTick();
    this._ptShow();
  }

  _ptStop() {
    if (!this._pt) return;
    this._pt = null;
    clearInterval(this._ptTimer);
    this._ptTimer = null;
    if (this._el) {
      if (!this._strokeKind) for (const i of [0, 1]) if (!this._padActive[i]) this._setPad(i, 0);
      this._outStop();
      this._ptShow();
    }
  }

  _ptTick() {
    const pt = this._pt;
    if (!pt || !this._el) return;
    const $ = this._el;
    const now = performance.now();
    const dt = Math.min(250, now - pt.last);
    pt.last = now;
    const speed = Number($('ptspeed').value);
    const strength = Number($('ptstr').value) / 100;
    let levels;
    if (pt.prog) {
      pt.prog.intensity = 0.4 + 0.58 * speed / 100;
      levels = pt.prog.step(dt);
    } else {
      pt.phase += dt / 1000 / patternPeriod(speed);
      levels = pt.key in PATTERNS_DUAL ? [0, 1].map((m) => patternDual(pt.key, pt.phase, m)) : [0, 1].map(() => patternLevel(pt.key, pt.phase));
    }
    const send = now - pt.outAt >= 100;
    if (send) pt.outAt = now;
    if (this._strokeKind) {
      // The stroke bar follows, within its range (unless you are moving it).
      const st = this._st;
      if (st.drag === null && this._stSpeed() === null) { st.pos = st.lower + levels[0] * strength * (st.upper - st.lower); this._stShow(); }
      if (send) {
        const vel = pt.prev ? (st.pos - pt.prev.pos) / Math.max(1, now - pt.prev.at) * 1000 : 0;
        pt.prev = { pos: st.pos, at: now };
        this._strokeOut(st.pos, vel);
      }
    } else {
      // The pads show it; a pad you hold wins until you let go.
      for (const i of [0, 1]) if (!this._padActive[i]) this._setPad(i, levels[i] * 100 * strength);
      if (send) this._padOut();
    }
    if (now - (pt.shownAt || 0) >= 1000) { pt.shownAt = now; this._ptShow(); }
  }

  // The stroke bar's position to every device, each its own way.
  _strokeOut(pos, vel) {
    this._outApply(this._outs.map((o, i) => {
      const p = parseTarget(this._outTargetValue(i));
      if (!p) return null;
      if (p.motor === 'l') return { goal: pos, dur: 120 };
      if (o.m === FOLLOW_AI) return this._aiStroke(i, pos, vel);
      if (o.m === FOLLOW_STROKER) return Math.round(pos);
      return Math.min(100, Math.max(0, liveIntensity(o.m, pos, vel)));
    }), 0.6);
  }

  _ptShow() {
    if (!this._el) return;
    const $ = this._el;
    const pt = this._pt;
    for (const b of this.shadowRoot.querySelectorAll('.ptbtn')) b.classList.toggle('on', Boolean(pt && pt.key === b.dataset.pt));
    $('ptdual').hidden = !this._twoPads || this._strokeKind;
    const random = Boolean(pt && pt.prog);
    $('ptspeedlab').textContent = random ? 'How busy' : 'Speed';
    $('ptspeedv').textContent = random ? `${$('ptspeed').value}%` : `${patternPeriod(Number($('ptspeed').value)).toFixed(1)} s`;
    $('ptstrv').textContent = `${$('ptstr').value}%`;
    const name = pt && (PATTERNS[pt.key] || PATTERNS_DUAL[pt.key] || 'Random');
    let text = PATTERN_HINT;
    if (pt) {
      const bits = [name];
      if (random) bits.push(pt.prog.seg.rest ? 'resting' : (pt.prog.seg.key ? (PATTERNS[pt.prog.seg.key] || PATTERNS_DUAL[pt.prog.seg.key]).toLowerCase() : 'steps'));
      if (this._outs && !this._outs.some((o, i) => parseTarget(this._outTargetValue(i)))) bits.push('no device: showing only');
      bits.push(this._strokeKind ? 'move the bar to take over' : 'touch a pad to take over');
      text = bits.join(' · ');
    }
    if ($('ptinfo').textContent !== text) $('ptinfo').textContent = text;
    $('ptstop').disabled = !pt;
    const tab = this.shadowRoot.querySelector('.ctltabs [data-ctl="pattern"]');
    if (tab) tab.classList.toggle('live', Boolean(pt));
  }

  // ---------------------------------------------------------- video: side controls
  _vsideShow() {
    if (!this._el) return;
    const $ = this._el;
    const video = $('video');
    const has = Boolean(this._vurl);
    $('vempty').hidden = !this._simple || has;
    $('vsplay').textContent = has && !video.paused ? '⏸' : '▶';
    $('vsplay').disabled = !has;
    $('vsaud').disabled = !has;
    $('vsaud').classList.toggle('on', Boolean(this._vaudio));
    $('vscast').classList.toggle('on', Boolean(this._cast || (this._castLink && this._castLink.connected)));
    $('vscast').disabled = !has;
    $('vsscript').classList.toggle('on', $('vscriptbox').classList.contains('open'));
    $('vsscript').classList.toggle('has', Boolean(this._vscript));
    $('vsoff').classList.toggle('on', $('voffbox').classList.contains('open'));
    $('vsfile').classList.toggle('has', has);
    this._vsSync();
  }

  // Full screen: the video and the slider over it (on its right, under the
  // thumb). The browser's own full screen shows the video alone, so this
  // card puts its whole video area full screen instead. iPhones only allow
  // the video itself, so there it is the plain video.
  _vFull() {
    const $ = this._el;
    if (!this._vurl) { this._toast('Choose a video first'); return; }
    const stage = this.shadowRoot.querySelector('.vstage');
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    const req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (req) {
      try { const r = req.call(stage); if (r && r.catch) r.catch((e) => this._toast('Full screen was refused: ' + (e.message || e))); } catch (e) { this._toast('Full screen was refused: ' + (e.message || e)); }
      return;
    }
    const video = $('video');
    if (video.webkitEnterFullscreen) { video.webkitEnterFullscreen(); this._toast('This phone only allows the video itself full screen, so the slider cannot show over it.'); return; }
    this._toast('This browser has no full screen.');
  }

  _vFullShow() {
    if (!this._el) return;
    const $ = this._el;
    const stage = this.shadowRoot.querySelector('.vstage');
    const on = this.shadowRoot.fullscreenElement === stage || (document.webkitFullscreenElement && this.shadowRoot.webkitFullscreenElement === stage);
    const bar = $('hb1');
    if (on === bar.classList.contains('ovl')) return;
    if (on) {
      this._hbHome = bar.nextSibling;
      stage.appendChild(bar);
    } else if (this._hbHome && this._hbHome.parentNode) {
      this._hbHome.parentNode.insertBefore(bar, this._hbHome);
    }
    bar.classList.toggle('vert', on);
    bar.classList.toggle('ovl', on);
    bar.setAttribute('aria-orientation', on ? 'vertical' : 'horizontal');
    const fill = bar.querySelector('.fill');
    fill.style.width = ''; fill.style.height = '';
    this._showHBar(0, this._hvals[0]);
    stage.classList.toggle('full', on);
    $('vsfull').classList.toggle('on', on);
    this._vlimShow();
  }

  // A stroker on the Play card keeps sound and scripts inside its limits
  // (set on the full screen line, or in the stroke recorder): 0-100 is
  // scaled into lower-upper.
  _lim(v) {
    const st = this._st;
    if (!this._simple || !st) return v;
    return Math.round(st.lower + (Math.min(100, Math.max(0, v)) / 100) * (st.upper - st.lower));
  }

  _isLinear(i) { const p = parseTarget(this._outTargetValue(i)); return Boolean(p && p.motor === 'l'); }

  // Vibrate / Stroke is chosen by hand; picking a device sets it to suit
  // (a stroker: stroke, anything else: vibrate), and can be switched back.
  _autoKind() {
    if (!this._simple || !this._outs || this._autoKindBusy) return;
    const kind = this._isLinear(0) ? 'stroke' : 'vibrate';
    if (kind === this._recKind) return;
    this._autoKindBusy = true;
    try { this._setRecKind(kind); } finally { this._autoKindBusy = false; }
  }

  // On the video (both kinds): a range bar on the left (drag the ends for
  // the limits, the middle to move it) and a speed line along the bottom.
  // While the video plays the level moves between the limits at that speed
  // or, with ♪ Beat and sound on, one way per beat, each turn on a beat.
  // A stroker goes to that position; a vibrator takes it as its intensity,
  // so the limits are its least and most. Speed 0 holds it still inside the
  // range (drag the range to set it by hand). A script, when there is one,
  // does the moving instead, inside the same limits.
  get _vsOn() { return Boolean(this._simple && this._ctl === 'video' && this._vurl); }

  _vsLoad() {
    if (this._vsCfg) return this._vsCfg;
    let kept = {};
    try { kept = JSON.parse(localStorage.getItem(VSTROKE_KEY) || '{}') || {}; } catch (_) { /* private mode */ }
    this._vsCfg = { speed: Number.isFinite(kept.speed) ? kept.speed : 40, beat: kept.beat !== false };
    return this._vsCfg;
  }

  _vsSave() { try { localStorage.setItem(VSTROKE_KEY, JSON.stringify(this._vsCfg)); } catch (_) { /* private mode */ } }

  // The range and level being moved: the stroker's own limits, or a
  // vibrator's least and most intensity (kept apart).
  get _vsRange() {
    if (this._strokeKind) return this._st;
    if (!this._vvLim) {
      let kept = {};
      try { kept = JSON.parse(localStorage.getItem(VVIBE_KEY) || '{}') || {}; } catch (_) { /* private mode */ }
      const ok = Number.isFinite(kept.lower) && Number.isFinite(kept.upper) && kept.upper - kept.lower >= 5;
      this._vvLim = { lower: ok ? kept.lower : 0, upper: ok ? kept.upper : 100, pos: ok ? kept.lower : 0, dir: 1, last: null };
    }
    return this._vvLim;
  }

  _vsKeep() {
    const r = this._vsRange;
    if (this._strokeKind) { this._gpSave(STROKE_LIMIT_KEY, { lower: r.lower, upper: r.upper, last: r.last }); if (this._stShow) this._stShow(); }
    else { try { localStorage.setItem(VVIBE_KEY, JSON.stringify({ lower: r.lower, upper: r.upper })); } catch (_) { /* private mode */ } }
  }

  // A vibrator's script level inside its least and most.
  _vvScale(v) { const r = this._vsRange; return Math.round(r.lower + (Math.min(100, Math.max(0, v)) / 100) * (r.upper - r.lower)); }

  // Sound drives it (♪ on and sound running), each Feel its own way.
  get _vsBeatOn() { return Boolean(this._vsLoad().beat && this._au); }
  get _vsFeel() { const el = this._el && this._el('aumode'); return (el && el.value) || 'beat'; }
  get _vsPaced() { return this._vsBeatOn && ['beat', 'updown'].includes(this._vsFeel); }

  _vsSync() {
    const on = this._vsOn;
    if (on && !this._vsTimer) { this._vsAt = performance.now(); this._vsTimer = setInterval(() => this._vsTick(), 50); }
    if (!on && this._vsTimer) { clearInterval(this._vsTimer); this._vsTimer = null; this._vsWasLive = false; }
    this._vlimShow();
  }

  _vsOnBeat(gap) {
    const r = this._vsRange;
    if (!r) return;
    this._vsBeat = { at: performance.now(), gap: gap || (this._vsBeat && this._vsBeat.gap) || 500 };
    // Turn on the beat: head away from the nearer end.
    r.dir = r.pos - r.lower < r.upper - r.pos ? 1 : -1;
  }

  // A stroker's speed now: units per ms (0 = held still), or null = stopped.
  _vsVel() {
    const r = this._vsRange;
    const video = this._el('video');
    if (this._vsPaced) {
      const b = this._vsBeat;
      if (!b || performance.now() - b.at > Math.max(1500, b.gap * 2.5)) return null;   // no beat lately
      return Math.min(strokeVel(100), (r.upper - r.lower) / b.gap);
    }
    if (this._vsBeatOn) return null;            // the sound places it (bass, volume)
    if (video.paused) return null;
    const pct = this._vsLoad().speed;
    return pct > 0 ? strokeVel(Math.max(STROKE_PCT_MIN, pct)) : 0;
  }

  // The sound, each reading (from the audio part): a stroker on bass or
  // volume goes to the level's place in its range; a vibrator takes the
  // level (beat, up and down, bass or volume) inside its least and most.
  _vsSound(r) {
    const range = this._vsRange;
    if (!range || !this._vsLoad().beat) return false;
    if (r.beat) this._vsOnBeat(r.gap);
    if (this._strokeKind) {
      if (this._vsPaced) return true;           // the beat paces the strokes (the tick)
      const now = performance.now();
      const pos = range.lower + (r.levels[0] / 100) * (range.upper - range.lower);
      const dt = now - (this._vsSndAt || now);
      const vel = dt > 0 ? (pos - range.pos) / dt * 1000 : 0;
      this._vsSndAt = now;
      range.pos = pos;
      this._strokeOut(pos, vel);
      this._vlimShow();
      return true;
    }
    if (this._vvHand !== null && this._vvHand !== undefined) return true;   // a finger has it
    const lv = r.levels.map((v) => this._vvScale(v));
    range.pos = lv[0];
    for (const i of [0, 1]) this._setPad(i, lv[i]);
    this._outApply([0, 1].map((i) => (i && !this._twoPads ? null : this._mapLevel(i, lv[i]))), 0.6);
    this._vsWasLive = true;
    this._vlimShow();
    return true;
  }

  _vsTick() {
    if (!this._el || !this._vsOn) { this._vsSync(); return; }
    const r = this._vsRange;
    const now = performance.now();
    const dt = now - (this._vsAt || now);
    this._vsAt = now;
    if (!r) return;
    if (!this._strokeKind) { this._vvTick(); return; }
    if (this._vraw) { this._vlimShow(); return; }      // the script moves it
    const vel = this._vsVel();
    if (vel === null) { this._vsWasLive = false; this._vlimShow(); return; }    // stays where it is
    if (vel > 0) { const m = strokeStep(r.pos, r.dir || 1, r.lower, r.upper, vel, dt); r.pos = m.pos; r.dir = m.dir; }
    else r.pos = Math.min(r.upper, Math.max(r.lower, r.pos));
    this._vsWasLive = true;
    // By hand (speed 0) with "Drop to 0" ticked: it follows only while the
    // range is held; let go and it goes to the bottom.
    const dropped = vel === 0 && this._el('vspring').checked && !this._el('vstrail').classList.contains('active');
    const goal = dropped ? r.lower : r.pos;
    if (vel > 0 || this._vsLastPos !== goal) this._strokeOut(goal, vel * 1000 * r.dir);
    this._vsLastPos = goal;
    this._vlimShow();
  }

  // A vibrator: an intensity, inside its least and most. A finger on the
  // line along the bottom sets it (over sound or a script, while held);
  // otherwise sound or the script sets it.
  _vvTick() {
    const r = this._vsRange;
    const hand = this._vvHand;
    const held = hand !== null && hand !== undefined;
    if (!held && (this._vraw || this._vsBeatOn)) { this._vlimShow(); return; }
    let v = 0;
    if (held) v = this._vvScale(hand);
    else if (!this._el('vspring').checked && this._vvKept) v = this._vvScale(this._vvKept);
    r.pos = v;
    if (v > 0) {
      for (const i of [0, 1]) this._setPad(i, v);
      this._outApply([0, 1].map((i) => (i && !this._twoPads ? null : this._mapLevel(i, v))), 0.6);
      this._vsWasLive = true;
    } else if (this._vsWasLive) {
      this._vsWasLive = false;
      for (const i of [0, 1]) this._setPad(i, 0);
      this._outStop();
    }
    this._vlimShow();
  }

  _vlimShow() {
    if (!this._el) return;
    const $ = this._el;
    const r = this._vsOn ? this._vsRange : null;
    const on = Boolean(r);
    $('vst').hidden = !on;
    if (this._simple) $('hb1').hidden = this._ctl === 'video';
    if (!on) return;
    const stroke = this._strokeKind;
    $('vst').classList.toggle('vib', !stroke);
    const band = $('vstrail').querySelector('.band');
    band.style.bottom = r.lower + '%';
    band.style.height = (r.upper - r.lower) + '%';
    band.querySelector('.hu').textContent = String(r.upper);
    band.querySelector('.hl').textContent = String(r.lower);
    $('vstrail').querySelector('.dot').style.bottom = Math.round(r.pos) + '%';
    $('vstrail').setAttribute('aria-label', stroke
      ? `Stroke range ${r.lower} to ${r.upper}: drag the ends to set the limits, the middle to move it`
      : `Intensity from ${r.lower}% to ${r.upper}%: drag the ends to set the least and most, the middle to move it`);
    const cfg = this._vsLoad();
    const script = Boolean(this._vraw);
    const sound = this._vsBeatOn && !script;
    $('vstbeat').hidden = !this._au || script;
    $('vstbeat').classList.toggle('on', sound);
    const line = $('vstline');
    let pct;
    let text;
    if (stroke) {
      line.setAttribute('aria-label', 'Stroke speed');
      line.classList.toggle('dim', sound || script);
      pct = cfg.speed;
      text = cfg.speed ? `${cfg.speed}%` : 'still';
      if (script) text = 'script';
      else if (sound && this._vsPaced) {
        const b = this._vsBeat;
        if (b && b.gap) { pct = Math.round(Math.min(100, ((r.upper - r.lower) / b.gap) / strokeVel(100) * 100)); text = `♪ ${Math.round(60000 / b.gap)}`; } else text = '♪ …';
      } else if (sound) text = '♪';
    } else {
      // A vibrator: the line is its intensity (shown inside its range).
      line.setAttribute('aria-label', 'Intensity');
      const held = this._vvHand !== null && this._vvHand !== undefined;
      line.classList.toggle('dim', !held && (sound || script));
      const span = r.upper - r.lower;
      pct = held ? this._vvHand : span > 0 ? Math.round((r.pos - r.lower) / span * 100) : 0;
      if (!held && !sound && !script && r.pos <= 0) pct = 0;
      text = `${Math.round(r.pos)}%`;
    }
    line.querySelector('.dot').style.left = Math.min(100, Math.max(0, pct)) + '%';
    line.setAttribute('aria-valuenow', String(pct));
    if ($('vstspdv').textContent !== text) $('vstspdv').textContent = text;
  }

  // Out of the way: faint while the video plays and nothing is touched.
  _vsWake() {
    const vst = this._el && this._el('vst');
    if (!vst) return;
    vst.classList.remove('idle');
    clearTimeout(this._vsIdleT);
    this._vsIdleT = setTimeout(() => { if (!vst.querySelector('.active')) vst.classList.add('idle'); }, 2500);
  }

  _bindVlim() {
    const $ = this._el;
    const rail = $('vstrail');
    let drag = null;
    // The rail reaches past both ends of its line, so the ends are easy to catch.
    const trk = rail.querySelector('.trk');
    const at = (e) => { const r = trk.getBoundingClientRect(); return Math.min(100, Math.max(0, ((r.bottom - e.clientY) / r.height) * 100)); };
    const move = (e) => {
      const st = this._vsRange;
      const p = at(e);
      if (drag.mode === 'upper') { st.upper = Math.round(Math.max(st.lower + 5, p)); st.last = 'upper'; }
      else if (drag.mode === 'lower') { st.lower = Math.round(Math.min(st.upper - 5, p)); st.last = 'lower'; }
      else {
        const span = st.upper - st.lower;
        const lo = Math.round(Math.min(100 - span, Math.max(0, p - drag.off)));
        st.lower = lo; st.upper = lo + span;
      }
      this._vlimShow();
    };
    rail.addEventListener('pointerdown', (e) => {
      const st = this._vsRange;
      if (!st) return;
      this._vsWake();
      e.preventDefault();
      const r = trk.getBoundingClientRect();
      const p = at(e);
      // The top third of the band (or above it) is the top end, the bottom
      // third (or below) the bottom end, the middle moves the whole range.
      const span = st.upper - st.lower;
      const zone = Math.max(28 / r.height * 100, span / 3);
      const mid = (st.lower + st.upper) / 2;
      if (p >= st.upper - zone && p >= mid) drag = { mode: 'upper' };
      else if (p <= st.lower + zone) drag = { mode: 'lower' };
      else drag = { mode: 'move', off: p - st.lower };
      rail.classList.add('active');
      try { rail.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
      move(e);
    });
    rail.addEventListener('pointermove', (e) => { if (drag) move(e); });
    const done = () => {
      if (!drag) return;
      drag = null;
      rail.classList.remove('active');
      this._vsKeep();
      this._vsWake();
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) rail.addEventListener(type, done);

    // The line along the bottom: a stroker's speed (this switches ♪ off),
    // or a vibrator's intensity (held, it takes over from sound or a script).
    const line = $('vstline');
    let sliding = false;
    const setLine = (e) => {
      const r = line.getBoundingClientRect();
      const v = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100));
      if (this._strokeKind) {
        const cfg = this._vsLoad();
        cfg.speed = Math.round(v / 5) * 5;
        cfg.beat = false;
      } else { this._vvHand = Math.round(v); this._vvKept = this._vvHand; this._vvTick(); }
      this._vlimShow();
    };
    line.addEventListener('pointerdown', (e) => { e.preventDefault(); sliding = true; line.classList.add('active'); this._vsWake(); try { line.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } setLine(e); });
    line.addEventListener('pointermove', (e) => { if (sliding) setLine(e); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      line.addEventListener(type, () => {
        if (!sliding) return;
        sliding = false;
        line.classList.remove('active');
        if (this._strokeKind) this._vsSave();
        else { this._vvHand = null; this._vvTick(); if (this._vraw) this._videoSend(true); }
        this._vsWake();
      });
    }
    $('vstbeat').textContent = '♪ Sound';
    $('vstbeat').title = 'The sound drives it, the way chosen in Feel';
    $('vstbeat').addEventListener('click', () => { const cfg = this._vsLoad(); cfg.beat = !cfg.beat; this._vsSave(); this._vlimShow(); this._vsWake(); });
    // Faint while the video plays; back on a touch or a pause.
    const video = $('video');
    video.addEventListener('play', () => this._vsWake());
    video.addEventListener('pause', () => { clearTimeout(this._vsIdleT); $('vst').classList.remove('idle'); });
    $('vst').addEventListener('pointerdown', () => this._vsWake());
    this.shadowRoot.querySelector('.vstage').addEventListener('pointerdown', () => this._vsWake());
  }

  // The video's own sound drives the devices: the audio settings sit under
  // the video while it is on.
  async _vaSet(on) {
    if (!this._el) return;
    const $ = this._el;
    if (on) {
      if (this._vaudio) return;
      if (!this._vurl) { this._toast('Choose a video first'); return; }
      this._vaPrev = $('ausrc').value;
      $('ausrc').value = 'video';
      this._vaudio = true;
      $('aubox').classList.add('fromvideo');
      $('vaubox').appendChild($('aubox'));
      this._ctlShow();
      await this._auStart();
      if (!this._au) { this._vaSet(false); return; }
      if (this._tap && !$('video').paused) this._videoRun();
    } else {
      if (!this._vaudio) return;
      this._vaudio = false;
      this._auStop();
      $('aubox').classList.remove('fromvideo');
      $('ctlbox').insertBefore($('aubox'), $('tgbox'));
      $('ausrc').value = this._vaPrev && this._vaPrev !== 'video' ? this._vaPrev : 'mic';
      this._ctlShow();
      this._auShow();
    }
    this._vsideShow();
  }
}
