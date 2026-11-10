// Part of the OggStudio card. Built into custom_components/oggstudio/frontend/oggstudio-card.js (npm run build).

// Audio into vibration. Fed with an analyser's frequency bins (0-255 each)
// a few times a second, it gives two levels (0-100): the first follows the
// beat, the bass or the loudness, the second the mids and highs.
export const AUDIO_MODES = { beat: 'Beat: a pulse on every beat', bass: 'Bass: follows the low end', volume: 'Volume: follows the loudness' };
export const AUDIO_GATE = 0.02;          // quieter than this is silence

const band = (bins, hzPerBin, from, to) => {
  const a = Math.max(1, Math.floor(from / hzPerBin)), b = Math.min(bins.length - 1, Math.ceil(to / hzPerBin));
  let sum = 0;
  for (let i = a; i <= b; i++) sum += bins[i];
  return b >= a ? sum / ((b - a + 1) * 255) : 0;
};

export class AudioFeel {
  constructor(sampleRate, fftSize) {
    this.hz = sampleRate / fftSize;      // width of one bin
    this.reset();
  }

  reset() {
    this.hist = [];                      // recent bass, for the beat
    this.peak = { bass: 0.1, mid: 0.1, all: 0.1 };
    this.pulse = 0;
    this.beatAt = -1e9;
    this.last = null;
    this.smooth = [0, 0];
    this.beats = 0;
  }

  // One reading. sens 0-1: how easily it reacts. Returns { levels, beat }.
  step(bins, now, mode = 'beat', sens = 0.5) {
    const dt = this.last === null ? 50 : Math.min(250, Math.max(1, now - this.last));
    this.last = now;
    const bass = band(bins, this.hz, 30, 180);
    const mid = band(bins, this.hz, 300, 4000);
    const all = band(bins, this.hz, 30, 8000);
    // Each band is read against its own recent peak, which fades slowly:
    // quiet music still gets the full range.
    const fade = Math.pow(0.5, dt / 6000);
    for (const [key, v] of [['bass', bass], ['mid', mid], ['all', all]]) this.peak[key] = Math.max(v, this.peak[key] * fade, 0.05);
    const gain = 0.6 + sens * 0.9;
    const rel = (v, key) => (all < AUDIO_GATE ? 0 : Math.min(1, v / this.peak[key] * gain));

    // A beat: bass jumping clear of its recent average.
    const avg = this.hist.length ? this.hist.reduce((a, b) => a + b, 0) / this.hist.length : bass;
    this.hist.push(bass);
    while (this.hist.length > 24) this.hist.shift();
    const clear = 1.55 - sens * 0.45;
    const beat = all >= AUDIO_GATE && this.hist.length > 4 && bass > avg * clear && bass > 0.06 && now - this.beatAt > 200;
    if (beat) { this.beatAt = now; this.beats += 1; this.pulse = Math.min(1, 0.55 + rel(bass, 'bass') * 0.45); }
    else this.pulse *= Math.pow(0.5, dt / 130);

    let first;
    if (mode === 'bass') first = rel(bass, 'bass');
    else if (mode === 'volume') first = rel(all, 'all');
    else first = Math.max(this.pulse, rel(bass, 'bass') * 0.25);
    const second = rel(mid, 'mid');
    // Rise at once, fall a little slower: motors feel better for it.
    const ease = (prev, v) => (v >= prev ? v : prev + (v - prev) * Math.min(1, dt / 120));
    this.smooth = [ease(this.smooth[0], first), ease(this.smooth[1], second)];
    return { levels: this.smooth.map((v) => Math.round(v * 100)), beat };
  }
}
