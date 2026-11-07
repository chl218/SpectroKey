import test from 'node:test';
import assert from 'node:assert/strict';
import { colormapLut, dbToUnit, rowToBin, rowToHz, paintColumn } from '../src/render.js';

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
