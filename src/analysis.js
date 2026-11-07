// Browser-only: static spectrogram of a recorded clip with hover readout, drag-zoom and exports.
import { stft } from './dsp.js';
import {
  paintColumn, rowToHz, rowBinRange, maxDb, poolFrames, columnFrameRange,
} from './render.js';
import { encodeWav } from './wav.js';

const MINUS = '−';

function stamp() {
  return new Date().toISOString().replace(/:/g, '-');
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createAnalysisView(canvas, readoutEl, onError = () => {}) {
  const ctx2d = canvas.getContext('2d');
  const wrap = canvas.parentElement;

  const sel = document.createElement('div');
  sel.style.cssText = 'position:absolute;top:0;bottom:0;display:none;pointer-events:none;'
    + 'background:rgba(255,255,255,0.25);border:1px solid rgba(255,255,255,0.8);';
  const empty = document.createElement('div');
  empty.textContent = 'Nothing recorded';
  empty.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;'
    + 'color:#fff;pointer-events:none;';
  wrap.append(sel, empty);

  let samples = null;
  let sampleRate = 0;
  let fftSize = 0;
  let hop = 0;
  let frames = [];
  let viewStart = 0;
  let viewEnd = 0; // exclusive
  let lastOpts = null;
  // Pixel columns currently drawn: one per frame when zoomed in, otherwise each
  // column max-pools the frames that fall in it. `pooled` is cached per view.
  let columns = 0;
  let pooled = [];
  let pooledKey = '';

  function paint() {
    if (!frames.length || !lastOpts) return;
    const dpr = window.devicePixelRatio || 1;
    const n = Math.max(1, viewEnd - viewStart);
    const displayW = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const w = Math.min(n, displayW);
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    const key = `${viewStart}|${viewEnd}|${w}`;
    if (key !== pooledKey) {
      pooled = poolFrames(frames, viewStart, viewEnd, w);
      pooledKey = key;
    }
    columns = w;
    canvas.width = w;
    canvas.height = h;
    const img = ctx2d.createImageData(w, h);
    const p = {
      floorDb: lastOpts.floorDb, ceilDb: lastOpts.ceilDb, scale: lastOpts.scale,
      lut: lastOpts.lut, sampleRate,
    };
    for (let x = 0; x < w; x++) paintColumn(img, x, pooled[x], p);
    ctx2d.putImageData(img, 0, 0);
  }

  // Display x (CSS px from the canvas's left edge) -> pixel column index.
  function xToColumn(x, cssWidth) {
    return Math.min(columns - 1, Math.max(0, Math.floor((x / cssWidth) * columns)));
  }

  function compute(opts) {
    fftSize = opts.fftSize;
    hop = fftSize / 4;
    frames = stft(samples, fftSize, hop);
    pooledKey = '';
    viewStart = 0;
    viewEnd = frames.length;
  }

  function show(newSamples, newRate, opts) {
    samples = newSamples;
    sampleRate = newRate;
    lastOpts = opts;
    readoutEl.textContent = '';
    sel.style.display = 'none';
    if (!samples || samples.length === 0) {
      samples = null;
      frames = [];
      pooled = [];
      pooledKey = '';
      fftSize = 0;
      canvas.width = 1;
      canvas.height = Math.max(1, canvas.clientHeight);
      ctx2d.fillStyle = '#000';
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';
    compute(opts);
    paint();
  }

  function rerender(opts) {
    lastOpts = opts;
    if (!samples) return;
    if (opts.fftSize !== fftSize) compute(opts);
    paint();
  }

  function resetZoom() {
    if (!frames.length) return;
    viewStart = 0;
    viewEnd = frames.length;
    paint();
  }

  // --- hover readout ---
  function fmtReadout(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!frames.length || !columns || !rect.width || !rect.height) return '';
    const col = xToColumn(clientX - rect.left, rect.width);
    const [a, b] = columnFrameRange(col, viewStart, viewEnd, columns);
    const row = Math.min(canvas.height - 1,
      Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * canvas.height)));
    const hz = rowToHz(row, canvas.height, sampleRate, lastOpts.scale);
    // Same value the pixel was painted from: max over the column's frames and the row's bins.
    const column = pooled[col];
    const [lo, hi] = rowBinRange(row, canvas.height, column.length, sampleRate, lastOpts.scale);
    const db = maxDb(column, lo, hi);
    // Time at the centre of the analysis window, for the middle of the column's frames.
    const midFrame = (a + b - 1) / 2;
    const t = (midFrame * hop + fftSize / 2) / sampleRate;
    const dbText = db < 0 ? `${MINUS}${Math.abs(db).toFixed(1)}` : db.toFixed(1);
    return `t = ${t.toFixed(2)} s · f = ${Math.round(hz).toLocaleString('en-US')} Hz · ${dbText} dB`;
  }

  // --- drag-zoom ---
  let dragX0 = null;
  let dragX1 = 0;

  function localX(e) {
    const rect = canvas.getBoundingClientRect();
    return Math.min(rect.width, Math.max(0, e.clientX - rect.left));
  }

  function drawSel() {
    const a = Math.min(dragX0, dragX1);
    sel.style.left = `${canvas.offsetLeft + a}px`;
    sel.style.width = `${Math.abs(dragX1 - dragX0)}px`;
    sel.style.display = 'block';
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!frames.length || e.button !== 0) return;
    dragX0 = dragX1 = localX(e);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragX0 !== null) {
      dragX1 = localX(e);
      drawSel();
    }
    readoutEl.textContent = fmtReadout(e.clientX, e.clientY);
  });
  function endDrag(e, apply) {
    if (dragX0 === null) return;
    dragX1 = localX(e);
    const x0 = Math.min(dragX0, dragX1);
    const x1 = Math.max(dragX0, dragX1);
    dragX0 = null;
    sel.style.display = 'none';
    if (!apply || x1 - x0 < 2) return;
    const w = canvas.getBoundingClientRect().width;
    if (!w || !columns) return;
    // Pixel columns under the selection -> the frames they cover (view stays in frames).
    const c0 = xToColumn(x0, w);
    const c1 = Math.max(c0, xToColumn(Math.max(x0, x1 - 1e-6), w));
    const s = columnFrameRange(c0, viewStart, viewEnd, columns)[0];
    const en = columnFrameRange(c1, viewStart, viewEnd, columns)[1];
    viewStart = s;
    viewEnd = Math.max(en, s + 1);
    paint();
  }
  canvas.addEventListener('pointerup', (e) => endDrag(e, true));
  canvas.addEventListener('pointercancel', (e) => endDrag(e, false));
  canvas.addEventListener('pointerleave', () => { readoutEl.textContent = ''; });
  canvas.addEventListener('dblclick', resetZoom);

  // --- exports ---
  function exportPng() {
    if (!frames.length) return;
    canvas.toBlob((blob) => {
      if (blob) download(blob, `spectrokey-${stamp()}.png`);
      else onError('Could not export the image.');
    }, 'image/png');
  }

  function exportWav() {
    if (!samples) return;
    download(new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' }), `spectrokey-${stamp()}.wav`);
  }

  return { show, rerender, resetZoom, exportPng, exportWav };
}
