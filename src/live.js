// Browser-only: scrolling live spectrogram drawn from an AnalyserNode.
import { paintColumn } from './render.js';

export function createLiveView(canvas, analyser, getOpts) {
  const ctx2d = canvas.getContext('2d');
  let raf = 0;
  let running = false;
  let freq = null; // reused Float32Array, reallocated when frequencyBinCount changes
  let img = null; // 1-px-wide column

  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const { width, height } = canvas;
    if (!width || !height) return;

    const bins = analyser.frequencyBinCount;
    if (!freq || freq.length !== bins) freq = new Float32Array(bins);
    analyser.getFloatFrequencyData(freq);

    if (!img || img.height !== height) img = ctx2d.createImageData(1, height);
    const opts = { ...getOpts(), sampleRate: analyser.context.sampleRate };
    paintColumn(img, 0, freq, opts);

    ctx2d.drawImage(canvas, -1, 0);
    ctx2d.putImageData(img, width - 1, 0);
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
      ctx2d.fillStyle = '#000';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    },
  };
}
