import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/wav.js';

test('wav header and size', () => {
  const b = encodeWav(new Float32Array(10), 48000); const v = new DataView(b);
  assert.equal(b.byteLength, 64);
  assert.equal(String.fromCharCode(...new Uint8Array(b,0,4)), 'RIFF');
  assert.equal(v.getUint32(24,true), 48000); assert.equal(v.getUint16(22,true), 1); assert.equal(v.getUint16(34,true), 16);
});
test('wav clamps out-of-range samples', () => {
  const v = new DataView(encodeWav(new Float32Array([2,-2]),8000));
  assert.equal(v.getInt16(44,true),32767); assert.equal(v.getInt16(46,true),-32768);
});
