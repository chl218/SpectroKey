import test from 'node:test';
import assert from 'node:assert/strict';
import { ANALYSER_TO_FULL_SCALE_DB } from '../src/live.js';

test('analyser offset maps a full-scale sine (~-13.6 dB) to ~0 dB', () => {
  assert.ok(Math.abs(ANALYSER_TO_FULL_SCALE_DB - 13.56) < 0.01);
  assert.ok(Math.abs(20 * Math.log10(0.42 / 2) + ANALYSER_TO_FULL_SCALE_DB) < 1e-9);
  assert.equal(-Infinity + ANALYSER_TO_FULL_SCALE_DB, -Infinity);
});
