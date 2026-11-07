import test from 'node:test';
import assert from 'node:assert/strict';
import {
  colormapLut, dbToUnit, rowToBin, rowToHz, rowBinRange, paintColumn, poolFrames, columnFrameRange,
} from '../src/render.js';

test('lut ends match anchors', () => {
  const l = colormapLut('viridis');
  assert.equal(l.length, 768);
  assert.deepEqual([...l.slice(0, 3)], [0x44, 0x01, 0x54]);
  assert.deepEqual([...l.slice(765)], [0xfd, 0xe7, 0x25]);
});

test('dbToUnit clamps', () => {
  assert.equal(dbToUnit(-200, -100, -10), 0);
  assert.equal(dbToUnit(0, -100, -10), 1);
  assert.equal(dbToUnit(-55, -100, -10), 0.5);
});

test('dbToUnit floor >= ceil returns 0, not NaN', () => {
  assert.equal(dbToUnit(-50, -40, -40), 0);
  assert.equal(dbToUnit(-50, -30, -40), 0);
});

test('linear: top row = last bin, bottom = bin 0', () => {
  assert.equal(rowToBin(0, 100, 1024, 48000, 'linear'), 1023);
  assert.equal(rowToBin(99, 100, 1024, 48000, 'linear'), 0);
});

test('log: every row finite and in range', () => {
  for (let r = 0; r < 200; r++) {
    const b = rowToBin(r, 200, 1024, 48000, 'log');
    assert.ok(Number.isFinite(b) && b >= 0 && b <= 1023);
  }
});

test('log: bottom row ≈ 20 Hz', () => {
  assert.ok(Math.abs(rowToHz(199, 200, 48000, 'log') - 20) < 1);
});

test('rowToHz: top row is Nyquist, linear bottom is 0', () => {
  assert.equal(rowToHz(0, 100, 48000, 'linear'), 24000);
  assert.equal(rowToHz(99, 100, 48000, 'linear'), 0);
  assert.ok(Math.abs(rowToHz(0, 200, 48000, 'log') - 24000) < 1e-6);
});

test('height 1 does not produce NaN', () => {
  assert.ok(Number.isFinite(rowToBin(0, 1, 1024, 48000, 'linear')));
  assert.ok(Number.isFinite(rowToBin(0, 1, 1024, 48000, 'log')));
  assert.ok(Number.isFinite(rowToHz(0, 1, 48000, 'log')));
});

test('paintColumn writes opaque pixels in column x only', () => {
  const img = { width: 3, height: 4, data: new Uint8ClampedArray(3 * 4 * 4) };
  const column = new Float32Array([-100, -80, -50, -10]);
  const lut = colormapLut('gray');
  paintColumn(img, 1, column, { floorDb: -100, ceilDb: -10, scale: 'linear', sampleRate: 48000, lut });
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 3; x++) {
      const i = (y * 3 + x) * 4;
      if (x === 1) {
        assert.equal(img.data[i + 3], 255);
      } else {
        assert.deepEqual([...img.data.slice(i, i + 4)], [0, 0, 0, 0]);
      }
    }
  }
  // top row = highest bin (-10 dB => white), bottom row = bin 0 (-100 dB => black)
  assert.deepEqual([...img.data.slice(4, 7)], [255, 255, 255]);
  const bottom = (3 * 3 + 1) * 4;
  assert.deepEqual([...img.data.slice(bottom, bottom + 3)], [0, 0, 0]);
});

// A single 0 dB bin among -120 dB bins must reach the brightest LUT colour in some row,
// even when there are many more bins than rows (FFT 8192 -> 4096 bins, 400 rows).
function brightestRowFor(binCount, height, peakBin, scale) {
  const lut = colormapLut('gray');
  const img = { width: 1, height, data: new Uint8ClampedArray(height * 4) };
  const column = new Float32Array(binCount).fill(-120);
  column[peakBin] = 0;
  paintColumn(img, 0, column, { floorDb: -100, ceilDb: -10, scale, sampleRate: 48000, lut });
  let best = 0;
  for (let r = 0; r < height; r++) best = Math.max(best, img.data[r * 4]);
  return best;
}

test('paintColumn: a peak between sampled bins is not lost (linear)', () => {
  // bin 1029 ~ 6029 Hz; its neighbours' rows round to bins 1026 and 1036 in a
  // one-bin-per-row sampler, so 1029 itself is never sampled.
  for (const bin of [1029, 1031, 2050, 4000, 4095, 0]) {
    assert.equal(brightestRowFor(4096, 400, bin, 'linear'), 255, `bin ${bin}`);
  }
});

test('paintColumn: a peak between sampled bins is not lost (log)', () => {
  // Bins below 20 Hz (0..3 at 5.86 Hz/bin) are off the log scale; start above.
  for (const bin of [171, 175, 1029, 3001, 4095]) {
    assert.equal(brightestRowFor(4096, 400, bin, 'log'), 255, `bin ${bin}`);
  }
});

test('paintColumn: every bin is visible somewhere (linear, many bins)', () => {
  for (let bin = 0; bin < 4096; bin += 7) {
    assert.equal(brightestRowFor(4096, 400, bin, 'linear'), 255, `bin ${bin}`);
  }
});

test('rowBinRange: linear rows tile the bins with no gaps or overlaps', () => {
  let expected = 4095;
  for (let r = 0; r < 400; r++) {
    const [lo, hi] = rowBinRange(r, 400, 4096, 48000, 'linear');
    assert.ok(lo <= hi, `row ${r}`);
    assert.equal(hi, expected, `row ${r} top`);
    expected = lo - 1;
  }
  assert.equal(expected, -1);
});

test('rowBinRange: more rows than bins still gives one bin per row', () => {
  for (let r = 0; r < 100; r++) {
    const [lo, hi] = rowBinRange(r, 100, 8, 48000, 'linear');
    assert.equal(lo, hi);
    assert.equal(lo, Math.round(rowToBin(r, 100, 8, 48000, 'linear')));
  }
});

function silentFrames(count, bins) {
  return Array.from({ length: count }, () => new Float32Array(bins).fill(-120));
}

test('poolFrames: one loud frame among silent ones survives pooling', () => {
  const frames = silentFrames(11000, 16);
  frames[5437][9] = 0;
  const cols = poolFrames(frames, 0, frames.length, 1000);
  assert.equal(cols.length, 1000);
  const hits = cols.flatMap((c, i) => (c[9] === 0 ? [i] : []));
  assert.deepEqual(hits, [Math.floor((5437 * 1000) / 11000)]);
  // Other bins stay silent, and the source frames are untouched.
  assert.ok(cols.every((c) => c.every((v, k) => k === 9 || v === -120)));
  assert.equal(frames[5436][9], -120);
});

test('poolFrames: zoomed view (fewer frames than columns) is one frame per column', () => {
  const frames = silentFrames(50, 4);
  const cols = poolFrames(frames, 10, 30, 1000);
  assert.equal(cols.length, 20);
  assert.equal(cols[0], frames[10]);
  assert.equal(cols[19], frames[29]);
});

test('columnFrameRange: columns partition the frames in order', () => {
  let next = 7;
  for (let c = 0; c < 300; c++) {
    const [a, b] = columnFrameRange(c, 7, 1007, 300);
    assert.equal(a, next);
    assert.ok(b > a);
    next = b;
  }
  assert.equal(next, 1007);
});
