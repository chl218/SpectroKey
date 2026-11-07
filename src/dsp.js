// Core DSP for SpectroKey: window, FFT, and magnitude-in-dB. Pure math, no DOM.

/**
 * Symmetric Hann window: w[i] = 0.5 * (1 - cos(2*pi*i / (n-1))).
 * Tapers the frame to zero at both ends to reduce spectral leakage.
 */
export function hann(n) {
  const w = new Float32Array(n);
  if (n === 1) { w[0] = 1; return w; }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

/**
 * In-place iterative radix-2 Cooley-Tukey FFT.
 * re/im hold the real and imaginary parts; on return they hold the spectrum.
 * Length must be a power of 2 and re/im must be the same length.
 */
export function fft(re, im) {
  const n = re.length;
  if (im.length !== n) throw new RangeError('re and im must have the same length');
  if (n < 1 || (n & (n - 1)) !== 0) throw new RangeError('FFT length must be a power of 2');

  // Step 1: bit-reversal permutation.
  // The iterative algorithm wants inputs in "bit-reversed" order: the sample at
  // index i moves to the index whose binary digits are i's reversed. For n = 8,
  // index 1 (001) swaps with 4 (100), 3 (011) with 6 (110). We keep a reversed
  // counter j that is incremented by adding 1 at the top bit and carrying downward.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit; // carry: clear set bits from the top
    j ^= bit;                            // set the first clear bit
    if (i < j) { // swap each pair only once
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  // Step 2: butterflies.
  // Build the transform bottom-up: combine pairs into 2-point DFTs, those into
  // 4-point DFTs, and so on until one n-point DFT remains (log2(n) stages).
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angle = (-2 * Math.PI) / size; // twiddle step: W = e^(-2*pi*i/size)
    for (let start = 0; start < n; start += size) { // each block of `size` samples
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(angle * k); // twiddle factor for this position
        const wi = Math.sin(angle * k);
        const a = start + k;            // top element of the butterfly
        const b = a + half;             // bottom element
        // t = twiddle * x[b] (complex multiply)
        const tr = re[b] * wr - im[b] * wi;
        const ti = re[b] * wi + im[b] * wr;
        // Butterfly: x[a] + t goes on top, x[a] - t on the bottom.
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr;        im[a] += ti;
      }
    }
  }
}

/**
 * Magnitude spectrum in dB for the first n/2 bins (up to Nyquist).
 * db = 20*log10(2*|X[k]| / windowSum), so a full-scale sine centered on a bin
 * reads ~0 dB. Values below floorDb (and silence) are clamped to floorDb.
 */
export function magnitudeDb(re, im, windowSum, floorDb = -120) {
  const bins = re.length >> 1;
  const out = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    const mag = (2 * Math.hypot(re[k], im[k])) / windowSum;
    const db = mag > 0 ? 20 * Math.log10(mag) : -Infinity;
    out[k] = db > floorDb ? db : floorDb; // also catches -Infinity
  }
  return out;
}

/**
 * Short-time Fourier transform: one dB column (fftSize/2 bins) per frame.
 * Frames start every `hop` samples; a frame running past the end is zero-padded.
 * Frame count = max(1, 1 + floor((n - fftSize) / hop)), so empty or short clips
 * still yield one frame.
 */
export function stft(samples, fftSize, hop, floorDb = -120) {
  const w = hann(fftSize);
  let windowSum = 0;
  for (let i = 0; i < fftSize; i++) windowSum += w[i];
  const frameCount = Math.max(1, 1 + Math.floor((samples.length - fftSize) / hop));
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    // Refill every frame: fft works in place, so re/im hold the previous spectrum.
    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      re[i] = s < samples.length ? samples[s] * w[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    frames.push(magnitudeDb(re, im, windowSum, floorDb));
  }
  return frames;
}
