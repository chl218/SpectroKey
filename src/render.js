// Pure rendering math: colormaps, dB scaling, canvas-row -> frequency mapping,
// and time pooling of frames into pixel columns.
// No DOM access; paintColumn works on any {width, height, data} RGBA image.

const ANCHORS = {
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  magma: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf'],
  gray: ['#000000', '#ffffff'],
};

const LOG_MIN_HZ = 20;

// The displayed frequency range tops out here: speech and music live below it.
export const MAX_HZ = 10000;

// Highest frequency shown: 10 kHz, or Nyquist if the device can't reach it.
export function topHz(sampleRate) {
  return Math.min(MAX_HZ, sampleRate / 2);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function colormapLut(name) {
  const anchors = ANCHORS[name];
  if (!anchors) throw new Error(`Unknown colormap: ${name}`);
  const rgb = anchors.map(hexToRgb);
  const lut = new Uint8Array(256 * 3);
  const segments = rgb.length - 1;
  for (let i = 0; i < 256; i++) {
    const pos = (i / 255) * segments;
    const seg = Math.min(Math.floor(pos), segments - 1);
    const frac = pos - seg;
    for (let c = 0; c < 3; c++) {
      lut[i * 3 + c] = Math.round(rgb[seg][c] + (rgb[seg + 1][c] - rgb[seg][c]) * frac);
    }
  }
  return lut;
}

export function dbToUnit(db, floorDb, ceilDb) {
  if (!(ceilDb > floorDb)) return 0;
  const u = (db - floorDb) / (ceilDb - floorDb);
  if (!(u > 0)) return 0; // also catches NaN
  return u > 1 ? 1 : u;
}

// Single source of truth for row -> Hz. Row 0 is the top (topHz), the bottom
// row is 0 Hz (linear) or 20 Hz (log). `row` may be fractional: row +/- 0.5
// gives the frequency at a row's edges.
function rowHz(row, height, sampleRate, scale) {
  const top = topHz(sampleRate);
  const t = height > 1 ? (height - 1 - row) / (height - 1) : 1;
  if (scale === 'log') return LOG_MIN_HZ * (top / LOG_MIN_HZ) ** t;
  return t * top;
}

// Hz -> fractional bin, unclamped. Bin k sits at k * nyquist / binCount Hz,
// the same convention for both scales.
function hzToBin(hz, binCount, sampleRate) {
  return (hz / (sampleRate / 2)) * binCount;
}

export function rowToHz(row, height, sampleRate, scale) {
  return rowHz(row, height, sampleRate, scale);
}

export function rowToBin(row, height, binCount, sampleRate, scale) {
  const bin = hzToBin(rowHz(row, height, sampleRate, scale), binCount, sampleRate);
  return Math.min(Math.max(bin, 0), binCount - 1);
}

/**
 * Inclusive bin range [lo, hi] that canvas `row` covers: every bin whose
 * centre lies between the row's lower edge (row + 0.5) and upper edge
 * (row - 0.5), clamped to [0, binCount - 1]. When rows outnumber bins the
 * range would be empty, so it always includes the bin nearest the row centre.
 */
export function rowBinRange(row, height, binCount, sampleRate, scale) {
  const last = binCount - 1;
  const lowEdge = hzToBin(rowHz(row + 0.5, height, sampleRate, scale), binCount, sampleRate);
  const highEdge = hzToBin(rowHz(row - 0.5, height, sampleRate, scale), binCount, sampleRate);
  const nearest = Math.round(rowToBin(row, height, binCount, sampleRate, scale));
  // Half-open [lowEdge, highEdge) so a bin on a shared edge belongs to one row only.
  const lo = Math.min(Math.max(Math.ceil(lowEdge), 0), nearest);
  const hi = Math.max(Math.min(Math.ceil(highEdge) - 1, last), nearest);
  return [lo, hi];
}

// paintColumn runs ~60 times a second in the live view; the ranges only change
// when the geometry does, so keep the last table.
let rangeKey = '';
let rangeTable = null;
function rowRanges(height, binCount, sampleRate, scale) {
  const key = `${height}|${binCount}|${sampleRate}|${scale}`;
  if (key !== rangeKey) {
    rangeTable = new Int32Array(height * 2);
    for (let row = 0; row < height; row++) {
      const [lo, hi] = rowBinRange(row, height, binCount, sampleRate, scale);
      rangeTable[row * 2] = lo;
      rangeTable[row * 2 + 1] = hi;
    }
    rangeKey = key;
  }
  return rangeTable;
}

// Loudest dB over the inclusive bin range [lo, hi].
export function maxDb(column, lo, hi) {
  let m = -Infinity;
  for (let k = lo; k <= hi; k++) if (column[k] > m) m = column[k];
  return m;
}

/**
 * Paint one dB column into image column x. Each row takes the max dB over the
 * bins it covers, so a narrow tone stays bright even with more bins than rows.
 */
export function paintColumn(img, x, column, opts) {
  const { floorDb, ceilDb, scale, sampleRate, lut } = opts;
  const { width, height, data } = img;
  const ranges = rowRanges(height, column.length, sampleRate, scale);
  for (let row = 0; row < height; row++) {
    const db = maxDb(column, ranges[row * 2], ranges[row * 2 + 1]);
    const unit = dbToUnit(db, floorDb, ceilDb);
    const li = Math.round(unit * 255) * 3;
    const p = (row * width + x) * 4;
    data[p] = lut[li];
    data[p + 1] = lut[li + 1];
    data[p + 2] = lut[li + 2];
    data[p + 3] = 255;
  }
}

const TIME_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60];

/**
 * Time-axis ticks for [t0, t1] seconds: the smallest tidy step giving at most
 * `maxTicks` ticks, and the multiples of that step inside the range.
 */
export function timeTicks(t0, t1, maxTicks) {
  if (!(t1 > t0) || maxTicks < 1) return { step: 0, ticks: [] };
  const eps = 1e-9;
  const count = (s) => Math.floor(t1 / s + eps) - Math.ceil(t0 / s - eps) + 1;
  const step = TIME_STEPS.find((s) => count(s) <= maxTicks) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const ticks = [];
  for (let k = Math.ceil(t0 / step - eps); k <= Math.floor(t1 / step + eps); k++) {
    ticks.push(Number((k * step).toFixed(2))); // 0.1 * 3 -> 0.3, not 0.30000000000000004
  }
  return { step, ticks };
}

// "1.5 s": as many decimals as the tick step needs.
export function formatSeconds(t, step) {
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return `${t.toFixed(decimals)} s`;
}

/**
 * Frames [a, b) that pixel column c shows when frames [start, end) are spread
 * over `columns` pixel columns. Every column gets at least one frame.
 */
export function columnFrameRange(c, start, end, columns) {
  const n = end - start;
  if (columns >= n) return [start + c, start + c + 1];
  const a = start + Math.floor((c * n) / columns);
  const b = start + Math.floor(((c + 1) * n) / columns);
  return [a, Math.max(b, a + 1)];
}

/**
 * Max-pool frames [start, end) into `columns` dB columns (per bin, loudest
 * frame wins), so a short loud event survives downsampling in time. With at
 * least as many columns as frames, returns the frames themselves (no copy).
 */
export function poolFrames(frames, start, end, columns) {
  const n = end - start;
  if (columns >= n) return frames.slice(start, end);
  const bins = frames[start].length;
  const out = [];
  for (let c = 0; c < columns; c++) {
    const [a, b] = columnFrameRange(c, start, end, columns);
    const col = new Float32Array(frames[a]);
    for (let f = a + 1; f < b; f++) {
      const fr = frames[f];
      for (let k = 0; k < bins; k++) if (fr[k] > col[k]) col[k] = fr[k];
    }
    out.push(col);
  }
  return out;
}
