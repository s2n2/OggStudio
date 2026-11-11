// Part of the OggStudio card. Built into custom_components/oggstudio/frontend/oggstudio-card.js (npm run build).
import { CAST_DRIFT, CAST_GRACE, CAST_PLATFORMS, duration, esc } from '../lib/core.js';

const LOCAL_CAST = 'local';      // a TV this browser casts to itself

// Methods mixed into OggStudioCard.
export class CastPart {
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
    $('vcast').addEventListener('click', () => this._castPicker($('castpop').hidden));
    this.shadowRoot.addEventListener('pointerdown', (e) => {
      if ($('castpop').hidden) return;
      const path = e.composedPath();
      if (!path.includes($('castpop')) && !path.includes($('vcast')) && !path.includes($('vscast'))) this._castPicker(false);
    });
    this._castShow();
  }

  _castTargets() {
    const plat = this._mpPlatform || {};
    const states = (this._hass && this._hass.states) || {};
    return Object.entries(states).map(([id, st]) => ({ ...st, entity_id: id }))
      .filter((st) => st.entity_id.startsWith('media_player.') && CAST_PLATFORMS.includes(plat[st.entity_id])
        && st.state !== 'unavailable' && ((st.attributes.supported_features || 0) & 512))
      .sort((x, y) => CAST_PLATFORMS.indexOf(plat[x.entity_id]) - CAST_PLATFORMS.indexOf(plat[y.entity_id])
        || String(x.attributes.friendly_name || x.entity_id).localeCompare(String(y.attributes.friendly_name || y.entity_id)));
  }

  _castName(entity) {
    if (entity === LOCAL_CAST) return 'the TV';
    const st = this._hass && this._hass.states[entity];
    return (st && st.attributes.friendly_name) || entity;
  }

  _castPicker(open) {
    const $ = this._el;
    if (!open) { $('castpop').hidden = true; this._castUnprep(); return; }
    if (!this._vurl) { this._toast('Choose a video first'); return; }
    if (this._canCastLocal && !this._cast) this._castPrepare();
    const item = (label, tag, fn) => { const b = document.createElement('button'); b.type = 'button'; b.innerHTML = `<span>${esc(label)}</span><small>${esc(tag)}</small>`; b.addEventListener('click', fn); return b; };
    const items = [];
    if (this._cast) items.push(item(`■ Stop casting to ${this._castName(this._cast.entity)}`, '', () => { this._castPicker(false); this._castEnd(true); }));
    // A TV where this phone is: the browser finds it (Chromecast or AirPlay).
    if (this._canCastLocal && !(this._cast && this._cast.entity === LOCAL_CAST)) {
      const b = item('📱 A TV near this phone', this._castPrepText(), () => this._castLocalGo());
      b.id = 'castlocal';
      items.push(b);
    }
    const targets = this._castTargets();
    if (targets.length) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = 'Through Home Assistant (TVs at home):'; items.push(d); }
    const plat = this._mpPlatform || {};
    for (const st of targets) {
      if (this._cast && this._cast.entity === st.entity_id) continue;
      const kind = { cast: 'Cast', dlna_dmr: 'DLNA', kodi: 'Kodi', apple_tv: 'Apple TV' }[plat[st.entity_id]] || '';
      items.push(item(st.attributes.friendly_name || st.entity_id, `${kind} · ${st.state}`, () => this._castStart(st.entity_id)));
    }
    if (!targets.length && !this._canCastLocal) {
      const d = document.createElement('div'); d.className = 'hint';
      d.textContent = 'No TV found: add your Chromecast or TV to Home Assistant (the Google Cast or DLNA integration) and it shows here.';
      items.push(d);
    }
    $('castlist').replaceChildren(...items);
    $('castpop').hidden = false;
  }

  // Chrome (not in the Home Assistant app) and Safari can cast from here.
  get _canCastLocal() { return typeof HTMLMediaElement !== 'undefined' && 'remote' in HTMLMediaElement.prototype; }

  // A TV near this phone: the browser's own picker (Chromecast, AirPlay).
  // It must be opened straight from the tap, so the relay's link is made
  // ready when this menu opens. The TV gets the link on the address this
  // page came from, so it must be able to reach Home Assistant there (your
  // Nabu Casa or other outside address when away from home).
  _castPrepare() {
    const file = this._vfileObj;
    const old = this._castPrep;
    if (old && old.fileObj === file) return;
    this._castUnprep();
    if (!file) return;
    const cast = { entity: LOCAL_CAST, phase: 'starting', prep: true, fileObj: file, state: 'Getting the link ready…' };
    this._castPrep = cast;
    this._castRelay(file, cast).then((url) => {
      if (this._castPrep !== cast) return;
      const rv = document.createElement('video');
      rv.preload = 'metadata';
      rv.muted = true;
      rv.playsInline = true;
      rv.className = 'castrv';
      rv.src = new URL(url, location.origin).href;
      this.shadowRoot.querySelector('.vstage').appendChild(rv);
      cast.rv = rv;
      cast.state = 'Looking for TVs…';
      this._castPrepSay();
      try {
        rv.remote.watchAvailability((yes) => { cast.avail = yes; cast.state = yes ? 'Found nearby: tap to choose' : 'No TV found by this browser yet'; this._castPrepSay(); })
          .catch(() => { cast.state = 'Tap to look for a TV'; this._castPrepSay(); });
      } catch (_) { cast.state = 'Tap to look for a TV'; this._castPrepSay(); }
    }).catch((e) => {
      if (this._castPrep !== cast) return;
      cast.state = 'Could not get a link: ' + ((e && e.message) || e);
      this._castPrepSay();
    });
  }

  _castPrepText() { return (this._castPrep && this._castPrep.state) || 'Chromecast or AirPlay, found by this browser'; }

  _castPrepSay() {
    const el = this._el && this._el('castlocal');
    if (el) el.querySelector('small').textContent = this._castPrepText();
  }

  _castUnprep() {
    const cast = this._castPrep;
    if (!cast) return;
    this._castPrep = null;
    cast.cancelled = true;
    if (cast.unsub) { try { cast.unsub(); } catch (_) { /* connection gone */ } }
    if (cast.rv) { try { cast.rv.remote.cancelWatchAvailability().catch(() => {}); } catch (_) { /* fine */ } cast.rv.removeAttribute('src'); cast.rv.remove(); }
  }

  // Straight from the tap: the browser asks which TV.
  _castLocalGo() {
    const cast = this._castPrep;
    if (!cast || !cast.rv) { this._toast(cast && cast.state ? cast.state : 'Getting the link ready… tap again in a moment.'); return; }
    const rv = cast.rv;
    let asked;
    try { asked = rv.remote.prompt(); } catch (e) { asked = Promise.reject(e); }
    this._castPrep = null;
    cast.prep = false;
    this._el('castpop').hidden = true;
    if (this._cast) this._castEnd(true);
    const video = this._el('video');
    cast.startAt = video.currentTime || 0;
    cast.since = performance.now();
    cast.file = cast.relay;
    this._cast = cast;
    this._castWake(true);
    this._castWasMuted = video.muted;
    video.muted = true;                   // the sound comes from the TV
    this._castQuiet('pause');
    rv.remote.onconnect = () => {
      if (this._cast !== cast) return;
      rv.muted = false;
      try { if (cast.startAt > 1) rv.currentTime = cast.startAt; } catch (_) { /* not loaded yet */ }
      rv.play().catch((e) => this._toast('The TV would not start: ' + ((e && e.message) || e)));
    };
    rv.remote.ondisconnect = () => { if (this._cast === cast) { this._castQuiet('pause'); this._castEnd(false, 'The TV was disconnected.'); } };
    asked.catch((e) => {
      if (this._cast !== cast) return;
      const why = e && e.name === 'NotFoundError' ? 'this browser found no TV it can cast to here'
        : e && e.name === 'NotSupportedError' ? 'this browser cannot cast this (in the Home Assistant app, open Home Assistant in Chrome or Safari instead)'
        : e && e.name === 'NotAllowedError' ? 'no TV was chosen'
        : `${(e && e.name) || 'error'}: ${(e && e.message) || e}`;
      this._castEnd(false, 'Not cast: ' + why + '.');
    });
    this._castShow();
    if (!this._castTimer) this._castTimer = setInterval(() => this._castSync(), 250);
  }

  // Open the relay: Home Assistant asks for blocks of the file, this answers them.
  async _castRelay(file, cast) {
    let ready;
    const link = new Promise((ok, fail) => { ready = ok; setTimeout(() => fail(new Error('Home Assistant did not open the link (update OggStudio?)')), 10000); });
    const answer = async (req, start, length) => {
      try {
        const body = await file.slice(start, start + length).arrayBuffer();
        if (this._cast !== cast && this._castPrep !== cast) return;
        const r = await this._hass.fetchWithAuth(`/api/oggstudio/relay_data/${cast.relay}/${req}`, { method: 'POST', body });
        if (r.ok) { cast.sent = (cast.sent || 0) + length; this._castShowSoon(); }
      } catch (_) { /* the TV asks again */ }
    };
    cast.unsub = await this._hass.connection.subscribeMessage((m) => {
      if (m.ready) { cast.relay = m.id; ready(m.url); } else if (m.req !== undefined) answer(m.req, m.start, m.length);
    }, { type: 'oggstudio/relay', name: file.name, size: file.size, mime: file.type || 'video/mp4' }, { resubscribe: false });
    if (this._cast !== cast && this._castPrep !== cast) { cast.unsub(); throw new Error('cancelled'); }
    return link;
  }

  _castShowSoon() {
    if (this._castShowTimer) return;
    this._castShowTimer = setTimeout(() => { this._castShowTimer = null; this._castShow(); }, 500);
  }

  // Keep the screen on while casting: the video streams from this device.
  async _castWake(on) {
    try {
      if (!on) { if (this._wake) await this._wake.release(); this._wake = null; return; }
      if (navigator.wakeLock && !this._wake && document.visibilityState === 'visible') {
        this._wake = await navigator.wakeLock.request('screen');
        this._wake.addEventListener('release', () => { this._wake = null; });
      }
    } catch (_) { /* not allowed here */ }
    if (!this._wakeBound) {
      this._wakeBound = true;
      document.addEventListener('visibilitychange', () => { if (this._cast) this._castWake(true); });
    }
  }

  async _castStart(entity) {
    this._castPicker(false);
    const file = this._vfileObj;
    if (!file) { this._toast('Choose a video first'); return; }
    if (this._cast) this._castEnd(this._cast.entity !== entity);
    const video = this._el('video');
    const cast = { entity, phase: 'starting', startAt: video.currentTime || 0, since: performance.now() };
    this._cast = cast;
    this._castShow();
    try {
      const url = await this._castRelay(file, cast);
      if (this._cast !== cast) return;
      cast.file = cast.relay;               // the TV's media id carries the relay id
      cast.since = performance.now();
      this._castWake(true);
      this._castWasMuted = video.muted;
      video.muted = true;                   // the sound comes from the TV
      this._castQuiet('pause');
      await this._hass.callService('media_player', 'play_media', {
        entity_id: entity, media_content_id: url, media_content_type: file.type || 'video/mp4',
      });
      if (!this._castTimer) this._castTimer = setInterval(() => this._castSync(), 250);
    } catch (e) {
      if (this._cast !== cast) return;
      this._castEnd(false, cast.cancelled ? undefined : 'Could not cast: ' + ((e && e.message) || e));
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
    if (cast.unsub) { try { cast.unsub(); } catch (_) { /* connection gone */ } }
    this._castWake(false);
    const video = this._el && this._el('video');
    if (video && this._castWasMuted !== undefined) { video.muted = this._castWasMuted; this._castWasMuted = undefined; }
    if (cast.rv) {
      const rv = cast.rv;
      try { rv.pause(); rv.removeAttribute('src'); rv.load(); } catch (_) { /* gone */ }
      rv.remove();
    } else if (stopTv && cast.relay && this._hass) this._hass.callService('media_player', 'media_stop', { entity_id: cast.entity }, undefined, false).catch(() => {});
    this._toast(message || 'Casting stopped.');
    this._castShow();
  }

  // Change the video here without it being sent back to the TV: the event
  // each change causes (play, pause, seeked) is expected and skipped once.
  _castQuiet(kind) {
    const cast = this._cast;
    const video = this._el('video');
    if (kind === 'play' ? !video.paused : kind === 'pause' ? video.paused : false) return;
    const key = typeof kind === 'string' ? kind : 'seek';
    if (cast) { cast.expect = cast.expect || {}; cast.expect[key] = { n: ((cast.expect[key] && cast.expect[key].n) || 0) + 1, until: performance.now() + 2000 }; }
    try {
      const r = kind === 'play' ? video.play() : kind === 'pause' ? video.pause() : (video.currentTime = kind.seek);
      if (r && r.catch) r.catch(() => {});
    } catch (_) { /* not loaded yet */ }
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
    if (this._castExpected(service === 'media_play' ? 'play' : service === 'media_pause' ? 'pause' : 'seek') || cast.phase !== 'on') return;
    cast.cmdUntil = performance.now() + CAST_GRACE;
    if (service === 'media_seek') cast.pos = null;
    if (cast.rv) {
      const rv = cast.rv;
      try {
        if (service === 'media_play') rv.play().catch(() => {});
        else if (service === 'media_pause') rv.pause();
        else if (service === 'media_seek') rv.currentTime = data.seek_position;
      } catch (e) { this._toast('The TV did not take that: ' + ((e && e.message) || e)); }
      return;
    }
    this._hass.callService('media_player', service, { entity_id: cast.entity, ...(data || {}) }, undefined, false)
      .catch((e) => this._toast('The TV did not take that: ' + ((e && e.message) || e)));
  }

  // Where the TV is now, from what Home Assistant last heard from it.
  _castTvPos(st) {
    const cast = this._cast;
    const a = st.attributes;
    if (!Number.isFinite(a.media_position)) return null;
    if (a.media_position_updated_at !== cast.stamp) {
      cast.fresh = cast.stamp !== undefined;    // seen arriving: time it from now
      cast.stamp = a.media_position_updated_at;
      cast.seenAt = Date.now();
    }
    if (st.state !== 'playing') return a.media_position;
    const since = cast.fresh ? Date.now() - cast.seenAt : Math.max(0, Date.now() - Date.parse(a.media_position_updated_at));
    return a.media_position + (Number.isFinite(since) ? since : 0) / 1000;
  }

  _castSync() {
    const cast = this._cast;
    if (!cast || !cast.relay || !this._el) return;
    if (cast.rv) { this._castSyncLocal(cast); return; }
    const st = this._hass.states[cast.entity];
    const video = this._el('video');
    if (!st) return;
    const now = performance.now();
    const ours = cast.file && String(st.attributes.media_content_id || '').includes(cast.file);
    if (cast.phase === 'starting') {
      if (ours && (st.state === 'playing' || st.state === 'paused')) {
        cast.phase = 'on';
        cast.lostAt = 0;
        this._toast(`Casting to ${this._castName(cast.entity)}. The devices follow the TV.`);
        if (cast.startAt > 1) {
          this._hass.callService('media_player', 'media_seek', { entity_id: cast.entity, seek_position: Math.round(cast.startAt * 10) / 10 }, undefined, false).catch(() => {});
          cast.cmdUntil = now + CAST_GRACE;
          this._castQuiet({ seek: cast.startAt });
        }
        this._castQuiet('play');
        this._castShow();
      } else if (now - cast.since > 30000) {
        this._castEnd(false, `${this._castName(cast.entity)} did not start the video. Chromecasts play MP4 (H.264) and WebM; check Home Assistant can reach the TV.`);
      }
      return;
    }
    // Something else on the TV now, or it was turned off.
    if (!ours || ['off', 'idle', 'standby', 'unavailable'].includes(st.state)) {
      if (!cast.lostAt) cast.lostAt = now;
      if (now - cast.lostAt > 4000) {
        this._castQuiet('pause');
        this._castEnd(false, `${this._castName(cast.entity)} stopped playing the video.`);
      }
      return;
    }
    cast.lostAt = 0;
    if (now < (cast.cmdUntil || 0)) { this._castShow(); return; }   // the TV is still catching up with us
    const pos = this._castTvPos(st);
    const playing = st.state === 'playing';
    if (playing && video.paused && !video.ended) this._castQuiet('play');
    if (!playing && !video.paused) this._castQuiet('pause');
    if (pos !== null && Number.isFinite(video.duration) && Math.abs(video.currentTime - pos) > CAST_DRIFT && pos < video.duration) {
      this._castQuiet({ seek: pos });
    }
    this._castShow();
  }

  // The same, for a TV the browser cast to: it reports where it is itself.
  _castSyncLocal(cast) {
    const rv = cast.rv;
    const video = this._el('video');
    const now = performance.now();
    if (cast.phase === 'starting') {
      if (rv.remote.state === 'connected' && !rv.paused) {
        cast.phase = 'on';
        this._toast('Casting to the TV. The devices follow it.');
        if (cast.startAt > 1) this._castQuiet({ seek: cast.startAt });
        this._castQuiet('play');
        this._castShow();
      } else if (now - cast.since > 60000) {
        this._castEnd(false, 'The TV did not start the video. It must be able to reach Home Assistant at ' + location.origin + ' (a home-only or VPN address will not do).');
      }
      return;
    }
    if (now < (cast.cmdUntil || 0)) { this._castShow(); return; }
    if (!rv.paused && video.paused && !video.ended) this._castQuiet('play');
    if (rv.paused && !video.paused) this._castQuiet('pause');
    const pos = rv.currentTime;
    if (Number.isFinite(pos) && Number.isFinite(video.duration) && Math.abs(video.currentTime - pos) > CAST_DRIFT && pos < video.duration) this._castQuiet({ seek: pos });
    this._castShow();
  }

  _castShow() {
    if (!this._el) return;
    const btn = this._el('vcast');
    const cast = this._cast;
    const text = !cast ? '📺 Cast' : cast.phase === 'starting' ? '📺 …' : '📺 On TV';
    if (btn.textContent !== text) btn.textContent = text;
    btn.classList.toggle('on', Boolean(cast && cast.phase === 'on'));
    this._videoStatus();
  }
}
