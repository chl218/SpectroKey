// Fixed-capacity mono sample buffer. append() returns true once full.
export function createClip(maxSamples) {
  const buf = new Float32Array(maxSamples);
  let len = 0;
  return {
    append(chunk) {
      const n = Math.min(chunk.length, maxSamples - len);
      if (n > 0) { buf.set(n === chunk.length ? chunk : chunk.subarray(0, n), len); len += n; }
      return len >= maxSamples;
    },
    toFloat32() { return buf.slice(0, len); },
    get length() { return len; },
  };
}
