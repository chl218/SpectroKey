// Pure rendering math: colormaps, dB scaling, and canvas-row -> frequency mapping.
// No DOM access; paintColumn works on any {width, height, data} RGBA image.

const ANCHORS = {
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  magma: ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf'],
  gray: ['#000000', '#ffffff'],
};

const LOG_MIN_HZ = 20;

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

// Single source of truth for row -> Hz. Row 0 is the top (highest frequency).
function rowHz(row, height, sampleRate, scale) {
  const nyquist = sampleRate / 2;
  const t = height > 1 ? (height - 1 - row) / (height - 1) : 1;
  if (scale === 'log') return LOG_MIN_HZ * (nyquist / LOG_MIN_HZ) ** t;
  return t * nyquist;
}

export function rowToHz(row, height, sampleRate, scale) {
  return rowHz(row, height, sampleRate, scale);
}

export function rowToBin(row, height, binCount, sampleRate, scale) {
  const nyquist = sampleRate / 2;
  const bin = (rowHz(row, height, sampleRate, scale) / nyquist) * (scale === 'log' ? binCount : binCount - 1);
  return Math.min(Math.max(bin, 0), binCount - 1);
}

export function paintColumn(img, x, column, opts) {
  const { floorDb, ceilDb, scale, sampleRate, lut } = opts;
  const { width, height, data } = img;
  const binCount = column.length;
  for (let row = 0; row < height; row++) {
    const bin = Math.round(rowToBin(row, height, binCount, sampleRate, scale));
    const unit = dbToUnit(column[bin], floorDb, ceilDb);
    const li = Math.round(unit * 255) * 3;
    const p = (row * width + x) * 4;
    data[p] = lut[li];
    data[p + 1] = lut[li + 1];
    data[p + 2] = lut[li + 2];
    data[p + 3] = 255;
  }
}
