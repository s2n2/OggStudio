// Part of the OggStudio card. Built into custom_components/oggstudio/frontend/oggstudio-card.js (npm run build).
import { FOLLOW_AI } from '../lib/ai.js';
import { liveIntensity } from '../lib/convert.js';
import { SAMPLE_MS, duration, fmt } from '../lib/core.js';
import { FOLLOW_STROKER, parseTarget } from '../lib/outputs.js';
import { PATTERNS, PATTERNS_DUAL, PATTERN_RANDOM, RandomProgram, patternDual, patternLevel, patternPeriod } from '../lib/patterns.js';

const PATTERN_KEY = 'oggstudio_pattern';
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
    $('vscast').classList.toggle('on', Boolean(this._cast));
    $('vscast').disabled = !has;
    $('vsscript').classList.toggle('on', $('vscriptbox').classList.contains('open'));
    $('vsscript').classList.toggle('has', Boolean(this._vscript));
    $('vsoff').classList.toggle('on', $('voffbox').classList.contains('open'));
    $('vsfile').classList.toggle('has', has);
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
