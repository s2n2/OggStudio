// Part of the OggStudio card. Built into custom_components/oggstudio/frontend/oggstudio-card.js (npm run build).

export const TAG = 'oggstudio-card';
export const VERSION = '0.15.0';
export const DEVICE_KEY = 'oggstudio_device';
export const SPEEDS = ['0.5x', '0.75x', '1x', '1.25x', '1.5x', '2x'];
export const SAMPLE_MS = 100;
export const LIVE_MS = 100;
export const VIDEO_TICK_MS = 100;
// Casting goes through Home Assistant: these integrations can play a video URL.
export const CAST_PLATFORMS = ['cast', 'dlna_dmr', 'kodi', 'apple_tv'];
export const CAST_DRIFT = 0.4;          // s: re-align the video here when the TV is further off
export const CAST_GRACE = 3500;         // ms after a command from here before the TV's state is followed again
export const VIDEO_OFFSET_KEY = 'oggstudio_video_offset';
export const PARTS = ['record', 'stroke', 'take', 'library', 'video', 'import'];
export const NO_DEVICE = 'none';           // record without a device
export const TAKE_SRC = 'take';      // "Current take" in script lists (never a saved name)
// One card class, several dashboard cards: each shows a subset of the parts.
export const VARIANTS = {
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
  'oggstudio-play-card': { name: 'OggStudio Play', sub: 'Manual, pattern, mood, audio or video: record any of them', parts: ['record', 'video', 'take'], simple: true, size: 8,
    description: 'One simple card: play by hand, a pattern, a mood, to sound or to a video, with one Record button for all of them.' },
  'oggstudio-together-card': { name: 'OggStudio Together', sub: 'Play together from two places', parts: [], together: true, size: 4,
    description: 'Start or join a Together session: each of you drives the devices of the other, inside the limits each has set.' },
};
// Pointer capture can fail (a pointer already gone); never let it stop a press.
export const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (_) { /* no capture */ } };
export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const b64 = (buf) => {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

export async function encodeCode(script) {
  const json = JSON.stringify(script);
  if (window.CompressionStream) {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
    return 'ogg1:' + b64(await new Response(stream).arrayBuffer());
  }
  return 'ogg0:' + b64(new TextEncoder().encode(json));
}

export async function decodeText(text) {
  const value = text.trim();
  if (value.startsWith('ogg1:')) {
    if (!window.DecompressionStream) throw new Error('This browser cannot read compressed codes');
    const stream = new Blob([unb64(value.slice(5))]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  if (value.startsWith('ogg0:')) return JSON.parse(new TextDecoder().decode(unb64(value.slice(5))));
  return JSON.parse(value);
}

export const duration = (s) => Math.max(
  s.actions.length ? s.actions[s.actions.length - 1].at : 0,
  s.channels && s.channels.V1.actions.length ? s.channels.V1.actions[s.channels.V1.actions.length - 1].at : 0);
export const fmt = (ms) => `${(ms / 1000).toFixed(1)} s`;
