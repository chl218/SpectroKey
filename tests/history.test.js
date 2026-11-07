import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRing } from '../src/history.js';

function filled(capacity, n) {
  const r = createRing(capacity);
  for (let i = 0; i < n; i++) r.push();
  return r;
}

test('push hands out slots in order and wraps', () => {
  const r = createRing(3);
  assert.deepEqual([r.push(), r.push(), r.push(), r.push()], [0, 1, 2, 0]);
  assert.equal(r.count, 3);
});

test('slotOf: age 0 is the newest column', () => {
  const r = filled(4, 6); // slots written: 0 1 2 3 0 1 -> newest in slot 1
  assert.equal(r.slotOf(0), 1);
  assert.equal(r.slotOf(1), 0);
  assert.equal(r.slotOf(3), 2);
  assert.equal(r.slotOf(4), -1); // older than anything kept
});

test('segments: live view of a full, unwrapped ring is one copy', () => {
  const r = filled(10, 10); // slots 0..9, newest 9
  assert.deepEqual(r.segments(0, 4), [{ srcX: 6, dstX: 0, len: 4 }]);
});

test('segments: wrapped ring splits into two copies, oldest first', () => {
  const r = filled(10, 13); // newest in slot 2
  // width 5, offset 0: ages 4..0 -> slots 8,9,0,1,2
  assert.deepEqual(r.segments(0, 5), [
    { srcX: 8, dstX: 0, len: 2 },
    { srcX: 0, dstX: 2, len: 3 },
  ]);
});

test('segments: scrolling back shifts the window to older slots', () => {
  const r = filled(10, 10);
  // offset 3: rightmost column shows age 3 (slot 6); width 4 -> slots 3..6
  assert.deepEqual(r.segments(3, 4), [{ srcX: 3, dstX: 0, len: 4 }]);
});

test('segments: with less history than the view, history is right-aligned', () => {
  const r = filled(10, 3); // slots 0..2
  assert.deepEqual(r.segments(0, 8), [{ srcX: 0, dstX: 5, len: 3 }]);
});

test('segments: empty ring copies nothing', () => {
  assert.deepEqual(createRing(5).segments(0, 4), []);
});

test('maxOffset and clampOffset keep the view inside the history', () => {
  const r = filled(10, 10);
  assert.equal(r.maxOffset(4), 6);
  assert.equal(r.clampOffset(99, 4), 6);
  assert.equal(r.clampOffset(-5, 4), 0);
  assert.equal(filled(10, 3).maxOffset(8), 0); // nothing older to scroll to
});

test('reset empties the ring', () => {
  const r = filled(4, 3);
  r.reset();
  assert.equal(r.count, 0);
  assert.equal(r.push(), 0);
});
