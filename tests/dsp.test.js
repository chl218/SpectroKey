import test from 'node:test';
import assert from 'node:assert/strict';
import { hann, fft, magnitudeDb, stft } from '../src/dsp.js';

test('hann endpoints ~0, center 1', () => {
  const w = hann(1025);
  assert.ok(Math.abs(w[0]) < 1e-6 && Math.abs(w[1024]) < 1e-6);
  assert.ok(Math.abs(w[512] - 1) < 1e-6);
});

test('fft: DC goes to bin 0', () => {
  const n = 8;
  const re = new Float32Array(n).fill(1);
  const im = new Float32Array(n);
  fft(re, im);
  assert.ok(Math.abs(re[0] - 8) < 1e-5);
  for (let k = 1; k < n; k++) {
    assert.ok(Math.abs(re[k]) < 1e-5 && Math.abs(im[k]) < 1e-5, `bin ${k}`);
  }
});

test('fft: impulse gives flat magnitude 1', () => {
  const n = 16;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  re[0] = 1;
  fft(re, im);
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs(Math.hypot(re[k], im[k]) - 1) < 1e-5, `bin ${k}`);
  }
});

test('fft: sine at bin 5 peaks at bin 5', () => {
  const n = 64;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 5 * i) / n);
  fft(re, im);
  let best = 0;
  let bestMag = -1;
  for (let k = 0; k < 32; k++) {
    const m = Math.hypot(re[k], im[k]);
    if (m > bestMag) { bestMag = m; best = k; }
  }
  assert.equal(best, 5);
});

test('fft rejects non power of 2', () => {
  assert.throws(() => fft(new Float32Array(6), new Float32Array(6)), RangeError);
});

test('fft rejects mismatched lengths', () => {
  assert.throws(() => fft(new Float32Array(8), new Float32Array(4)), RangeError);
});

test('magnitudeDb: full-scale windowed sine ≈ 0 dB', () => {
  const n = 1024;
  const w = hann(n);
  let windowSum = 0;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    windowSum += w[i];
    re[i] = Math.sin((2 * Math.PI * 64 * i) / n) * w[i];
  }
  fft(re, im);
  const db = magnitudeDb(re, im, windowSum);
  assert.equal(db.length, n / 2);
  assert.ok(Math.abs(db[64]) < 0.5, `peak was ${db[64]} dB`);
});

test('magnitudeDb: silence clamps to floor, no -Infinity/NaN', () => {
  const db = magnitudeDb(new Float32Array(16), new Float32Array(16), 8, -120);
  assert.ok(db.every(v => v === -120));
});

test('stft frame count', () => {
  assert.equal(stft(new Float32Array(4096), 1024, 256).length, 13);
});

test('stft: clip shorter than window gives 1 padded frame', () => {
  const f = stft(new Float32Array(100).fill(0.5), 1024, 256);
  assert.equal(f.length, 1);
  assert.equal(f[0].length, 512);
  assert.ok(f[0].every(Number.isFinite));
});

test('stft: empty clip gives 1 frame at floor', () => {
  assert.ok(stft(new Float32Array(0), 512, 128)[0].every(v => v === -120));
});

test('stft: 1 kHz tone peaks at 1 kHz bin', () => {
  const sr = 48000;
  const size = 2048;
  const x = new Float32Array(sr / 2);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * 1000 * i) / sr);
  const frames = stft(x, size, size / 4);
  const expected = Math.round((1000 * size) / sr);
  assert.equal(expected, 43);
  assert.ok(frames.length > 1);
  for (const col of frames) {
    assert.equal(col.length, size / 2);
    let best = 0;
    for (let k = 1; k < col.length; k++) if (col[k] > col[best]) best = k;
    assert.ok(Math.abs(best - expected) <= 1, `peak bin ${best}`);
  }
});
