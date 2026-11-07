import test from 'node:test';
import assert from 'node:assert/strict';
import { createClip } from '../src/clip.js';

test('clip caps at max and reports full', () => {
  const c = createClip(5); assert.equal(c.append(new Float32Array(3)), false);
  assert.equal(c.append(new Float32Array(3)), true); assert.equal(c.length, 5); assert.equal(c.toFloat32().length, 5);
});
test('clip append after full copies nothing; toFloat32 is a copy', () => {
  const c = createClip(3);
  assert.equal(c.append(new Float32Array([1,2,3])), true);
  assert.equal(c.append(new Float32Array([9])), true);
  const out = c.toFloat32(); assert.deepEqual([...out], [1,2,3]);
  out[0] = 7; assert.equal(c.toFloat32()[0], 1);
});
