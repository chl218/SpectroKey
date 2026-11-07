// Browser-only: scrolling live spectrogram drawn from an AnalyserNode, with a
// history you can scroll back through while paused.
import { paintColumn } from './render.js';
import { createRing } from './history.js';

// AnalyserNode dB = 20*log10(|X[k]| / N) with a Blackman window, whose coherent
// gain (mean of the window) is ~0.42: a full-scale sine reads 20*log10(0.42/2)
// ~ -13.6 dB. dsp.magnitudeDb uses 2|X| / windowSum, where that sine reads 0 dB.
// Adding this offset puts both views on the same full-scale reference
// (0 dB = full-scale sine), so the floor/ceiling sliders mean the same thing.
export const ANALYSER_TO_FULL_SCALE_DB = 20 * Math.log10(2 / 0.42); // ~ +13.56

// Columns of history kept: ~60 s at a 60 Hz display (one column per frame).
export const HISTORY_COLUMNS = 3600;

export function createLiveView(canvas, analyser, getOpts) {
  const ctx2d = canvas.getContext('2d');
  let raf = 0;
  let running = false;
  let paused = false;
  let offset = 0; // columns back from the newest shown at the right edge (0 = now)
  let freq = null; // reused Float32Array, reallocated when frequencyBinCount changes
  let img = null; // 1-px-wide column

  // History: already-coloured columns in an off-screen canvas used as a ring.
  const store = document.createElement('canvas');
  const storeCtx = store.getContext('2d');
  let ring = null;
  let times = null; // capture time (ms) of each slot, for "x s ago"

  // (Re)build the history when the view's size changes; that clears it.
  function ensureStore() {
    const capacity = Math.max(HISTORY_COLUMNS, canvas.width);
    if (ring && store.height === canvas.height && ring.capacity === capacity) return;
    store.width = capacity;
    store.height = canvas.height;
    ring = createRing(capacity);
    times = new Float64Array(capacity);
    offset = 0;
  }

  function draw() {
    const { width, height } = canvas;
    ctx2d.fillStyle = '#000';
    ctx2d.fillRect(0, 0, width, height);
    if (!ring) return;
    for (const s of ring.segments(offset, width)) {
      ctx2d.drawImage(store, s.srcX, 0, s.len, height, s.dstX, 0, s.len, height);
    }
  }

  function capture() {
    const bins = analyser.frequencyBinCount;
    if (!freq || freq.length !== bins) freq = new Float32Array(bins);
    analyser.getFloatFrequencyData(freq);
    // -Infinity (silent bins) stays -Infinity.
    for (let k = 0; k < bins; k++) freq[k] += ANALYSER_TO_FULL_SCALE_DB;

    if (!img || img.height !== canvas.height) img = storeCtx.createImageData(1, canvas.height);
    paintColumn(img, 0, freq, { ...getOpts(), sampleRate: analyser.context.sampleRate });
    const slot = ring.push();
    times[slot] = performance.now();
    storeCtx.putImageData(img, slot, 0);
  }

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!canvas.width || !canvas.height) return;
    ensureStore();
    // Paused: the history and the view stay frozen until resume().
    if (paused) return;
    capture();
    draw();
  }

  return {
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    clear() {
      if (ring) ring.reset();
      offset = 0;
      draw();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      offset = 0;
    },
    isPaused() {
      return paused;
    },
    // Scroll the paused view by `columns` (positive = further back in time).
    scrollBy(columns) {
      if (!paused || !ring) return;
      offset = ring.clampOffset(offset + columns, canvas.width);
      draw();
    },
    // Seconds between the newest captured column and the one at the right edge.
    secondsAgo() {
      if (!ring || ring.count === 0) return 0;
      return (times[ring.slotOf(0)] - times[ring.slotOf(offset)]) / 1000;
    },
  };
}
