# Spectrogram App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser page that shows a live scrolling spectrogram of the microphone and lets you record a clip (max 30 s) to study, hover, zoom and export as PNG/WAV.

**Architecture:** Plain ES modules, no build step and no libraries. Pure modules (`dsp`, `render`, `wav`, `clip`) hold all math and are unit-tested with `node --test`; thin browser modules (`audio`, `live`, `analysis`, `app`) wire Web Audio and canvas to them. Live view uses the browser `AnalyserNode`; the recorded clip is rendered with our own FFT/STFT.

**Tech Stack:** HTML/CSS, JavaScript ES modules, Web Audio API (`AnalyserNode`, `AudioWorklet`), Canvas 2D, Node 26 built-in test runner. Local preview via `python -m http.server`.

**Spec:** `docs/superpowers/specs/2026-11-06-spectrogram-app-design.md`

## Global Constraints

- Everything lives under the `SpectroKey` folder; touch nothing outside it.
- No external libraries, no build step. Browser loads `index.html` + `src/*.js` directly.
- Mic only; mono. No file upload, no stereo, no persistence, no pitch detection.
- Recording cap: **30 s** (`MAX_SECONDS = 30`), auto-stop with a visible notice.
- FFT size choices: **512, 1024, 2048, 4096, 8192**; default 2048.
- Frequency scale: `linear` | `log` (log range 20 Hz → Nyquist).
- Colormaps: `viridis` (default), `magma`, `gray`.
- Default dB range: floor **-100**, ceiling **-10**.
- STFT: Hann window, hop = `fftSize / 4`.
- Always use `ctx.sampleRate`; never assume 44100 or 48000.

## Review Focus

1. **Silent input (all zeros)** — `log10(0)` must not produce `-Infinity`/`NaN` pixels; values clamp to the dB floor. (Test in Task 1.)
2. **Clip shorter than one FFT window** (tap Record then Stop instantly) — analysis still draws one zero-padded frame, never blank or crashing. (Test in Task 2; empty clip handled in Task 7.)
3. **dB floor dragged to or above ceiling** — no division by zero; `dbToUnit` returns 0, UI keeps floor ≤ ceiling − 1. (Test in Task 3.)
4. **Log scale at 0 Hz** — row→bin mapping must never take `log(0)` or return `NaN`/out-of-range bins. (Test in Task 3.)
5. **Double clicks / restarts** — pressing Start mic or Record twice must not open a second stream or recorder; buttons reflect state. (Manual check in Task 6.)

---

## File Structure

```
SpectroKey/
  index.html              page layout, styles, loads src/app.js
  package.json            {"type":"module","scripts":{"test":"node --test tests/"}}
  .gitignore
  .claude/launch.json     preview server config
  src/dsp.js              hann, fft, magnitudeDb, stft  (pure)
  src/render.js           colormaps, dB→unit, row→bin, paintColumn  (pure)
  src/wav.js              encodeWav  (pure)
  src/clip.js             capped sample accumulator  (pure)
  src/recorder-worklet.js AudioWorkletProcessor posting sample chunks
  src/audio.js            startMic, startRecording
  src/live.js             live waterfall loop
  src/analysis.js         clip render, hover readout, zoom, exports
  src/app.js              UI wiring and state
  tests/*.test.js
```

---

### Task 1: Project setup + core DSP

**Files:**
- Create: `package.json`, `.gitignore` (`node_modules/`), `src/dsp.js`
- Test: `tests/dsp.test.js`

**Interfaces:**
- Produces:
  - `hann(n: number): Float32Array`
  - `fft(re: Float32Array, im: Float32Array): void` — in place; throws `RangeError` if length is not a power of 2 or lengths differ.
  - `magnitudeDb(re: Float32Array, im: Float32Array, windowSum: number, floorDb = -120): Float32Array` — length `n/2`; `db = 20*log10(2*|X[k]| / windowSum)`, clamped to `floorDb`. A full-scale sine centered on a bin reads ≈ 0 dB.

- [ ] **Step 1: `git init` in `SpectroKey`, create `package.json` and `.gitignore`.**
- [ ] **Step 2: Write failing tests**

```js
test('hann endpoints ~0, center 1', () => {
  const w = hann(1025);
  assert.ok(Math.abs(w[0]) < 1e-6 && Math.abs(w[1024]) < 1e-6);
  assert.ok(Math.abs(w[512] - 1) < 1e-6);
});
test('fft: DC goes to bin 0', () => { /* re = all 1, n=8 → re[0]=8, other bins ≈0 */ });
test('fft: impulse gives flat magnitude 1', () => { /* re[0]=1, n=16 → |X[k]|=1 for all k */ });
test('fft: sine at bin 5 peaks at bin 5', () => { /* n=64, re[i]=sin(2π·5·i/64) → argmax over 0..31 is 5 */ });
test('fft rejects non power of 2', () => { assert.throws(() => fft(new Float32Array(6), new Float32Array(6)), RangeError); });
test('magnitudeDb: full-scale windowed sine ≈ 0 dB', () => { /* n=1024, bin 64, Hann; peak within ±0.5 dB of 0 */ });
test('magnitudeDb: silence clamps to floor, no -Infinity/NaN', () => {
  const db = magnitudeDb(new Float32Array(16), new Float32Array(16), 8, -120);
  assert.ok(db.every(v => v === -120));
});
```

- [ ] **Step 3: Run `npm test`** — Expected: FAIL (module not found).
- [ ] **Step 4: Implement `src/dsp.js`.** `fft` is iterative radix-2 Cooley–Tukey (bit-reversal permutation, then butterflies). Comment each stage for readers learning the algorithm — this is the "learning" goal of the spec.
- [ ] **Step 5: Run `npm test`** — Expected: all PASS.
- [ ] **Step 6: Commit** `feat: core DSP (hann, fft, magnitudeDb)` — include `docs/` (spec and this plan) in this first commit.

---

### Task 2: STFT

**Files:**
- Modify: `src/dsp.js`
- Test: `tests/dsp.test.js`

**Interfaces:**
- Consumes: `hann`, `fft`, `magnitudeDb` (Task 1).
- Produces: `stft(samples: Float32Array, fftSize: number, hop: number, floorDb = -120): Float32Array[]` — one dB column (length `fftSize/2`) per frame. Frame count = `max(1, 1 + floor((samples.length - fftSize) / hop))`; a frame running past the end is zero-padded.

- [ ] **Step 1: Write failing tests**

```js
test('stft frame count', () => {
  assert.equal(stft(new Float32Array(4096), 1024, 256).length, 13);
});
test('stft: clip shorter than window gives 1 padded frame', () => {
  const f = stft(new Float32Array(100).fill(0.5), 1024, 256);
  assert.equal(f.length, 1); assert.equal(f[0].length, 512);
  assert.ok(f[0].every(Number.isFinite));
});
test('stft: empty clip gives 1 frame at floor', () => {
  assert.ok(stft(new Float32Array(0), 512, 128)[0].every(v => v === -120));
});
test('stft: 1 kHz tone peaks at 1 kHz bin', () => { /* sr 48000, fft 2048 → peak bin round(1000*2048/48000)=43 ±1 in every frame */ });
```

- [ ] **Step 2: Run `npm test`** — Expected: new tests FAIL.
- [ ] **Step 3: Implement `stft`** reusing one Hann window and one pair of scratch buffers across frames.
- [ ] **Step 4: Run `npm test`** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: STFT`

---

### Task 3: Rendering math

**Files:**
- Create: `src/render.js`
- Test: `tests/render.test.js`

**Interfaces:**
- Produces:
  - `colormapLut(name: 'viridis'|'magma'|'gray'): Uint8Array` — 256 RGB entries (length 768), built by linear interpolation between anchors:
    - viridis: `#440154 #482878 #3e4989 #31688e #26828e #1f9e89 #35b779 #6ece58 #b5de2b #fde725`
    - magma: `#000004 #1c1044 #4f127b #812581 #b5367a #e55964 #fb8761 #fec287 #fcfdbf`
    - gray: `#000000 #ffffff`
  - `dbToUnit(db: number, floorDb: number, ceilDb: number): number` — clamped to [0,1]; returns 0 when `ceilDb <= floorDb`.
  - `rowToBin(row: number, height: number, binCount: number, sampleRate: number, scale: 'linear'|'log'): number` — row 0 is the top (highest frequency). Linear: evenly spaced 0 Hz→Nyquist. Log: 20 Hz→Nyquist on a log axis. Returns a fractional bin clamped to `[0, binCount-1]`.
  - `rowToHz(row, height, sampleRate, scale): number` — same mapping, in Hz (used by the hover readout).
  - `paintColumn(img: {width, height, data}, x: number, column: Float32Array, opts: {floorDb, ceilDb, scale, sampleRate, lut}): void` — fills pixel column `x`; each row samples `column` at `rowToBin` (nearest bin is fine), alpha 255.

- [ ] **Step 1: Write failing tests**

```js
test('lut ends match anchors', () => { const l = colormapLut('viridis'); assert.deepEqual([...l.slice(0,3)], [0x44,0x01,0x54]); assert.deepEqual([...l.slice(765)], [0xfd,0xe7,0x25]); });
test('dbToUnit clamps', () => { assert.equal(dbToUnit(-200,-100,-10),0); assert.equal(dbToUnit(0,-100,-10),1); assert.equal(dbToUnit(-55,-100,-10),0.5); });
test('dbToUnit floor >= ceil returns 0, not NaN', () => { assert.equal(dbToUnit(-50,-40,-40),0); assert.equal(dbToUnit(-50,-30,-40),0); });
test('linear: top row = last bin, bottom = bin 0', () => { assert.equal(rowToBin(0,100,1024,48000,'linear'),1023); assert.equal(rowToBin(99,100,1024,48000,'linear'),0); });
test('log: every row finite and in range', () => { for (let r=0;r<200;r++){const b=rowToBin(r,200,1024,48000,'log'); assert.ok(Number.isFinite(b)&&b>=0&&b<=1023);} });
test('log: bottom row ≈ 20 Hz', () => { assert.ok(Math.abs(rowToHz(199,200,48000,'log')-20) < 1); });
test('paintColumn writes opaque pixels in column x only', () => { /* 3×4 fake image, x=1; column 1 alpha all 255, columns 0 and 2 untouched (0) */ });
```

- [ ] **Step 2: Run `npm test`** — Expected: FAIL.
- [ ] **Step 3: Implement `src/render.js`.**
- [ ] **Step 4: Run `npm test`** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: colormaps and frequency mapping`

---

### Task 4: WAV encoder and capped clip buffer

**Files:**
- Create: `src/wav.js`, `src/clip.js`
- Test: `tests/wav.test.js`, `tests/clip.test.js`

**Interfaces:**
- Produces:
  - `encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer` — 16-bit PCM mono, 44-byte RIFF header, samples clamped to [-1,1].
  - `createClip(maxSamples: number): { append(chunk: Float32Array): boolean, toFloat32(): Float32Array, readonly length: number }` — `append` copies only what fits and returns `true` once full.

- [ ] **Step 1: Write failing tests**

```js
test('wav header and size', () => {
  const b = encodeWav(new Float32Array(10), 48000); const v = new DataView(b);
  assert.equal(b.byteLength, 64);
  assert.equal(String.fromCharCode(...new Uint8Array(b,0,4)), 'RIFF');
  assert.equal(v.getUint32(24,true), 48000); assert.equal(v.getUint16(22,true), 1); assert.equal(v.getUint16(34,true), 16);
});
test('wav clamps out-of-range samples', () => { const v = new DataView(encodeWav(new Float32Array([2,-2]),8000)); assert.equal(v.getInt16(44,true),32767); assert.equal(v.getInt16(46,true),-32768); });
test('clip caps at max and reports full', () => {
  const c = createClip(5); assert.equal(c.append(new Float32Array(3)), false);
  assert.equal(c.append(new Float32Array(3)), true); assert.equal(c.length, 5); assert.equal(c.toFloat32().length, 5);
});
```

- [ ] **Step 2: Run `npm test`** — Expected: FAIL.
- [ ] **Step 3: Implement both modules.**
- [ ] **Step 4: Run `npm test`** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: WAV encoder and capped clip buffer`

---

### Task 5: Audio capture and recorder

**Files:**
- Create: `src/audio.js`, `src/recorder-worklet.js`

**Interfaces:**
- Consumes: `createClip` (Task 4).
- Produces:
  - `startMic(): Promise<{ ctx: AudioContext, source: MediaStreamAudioSourceNode, stream: MediaStream }>` — calls `ctx.resume()`; on failure throws `MicError` with `kind: 'denied' | 'unavailable' | 'unsupported'` (`NotAllowedError` → denied, `NotFoundError`/`NotReadableError` → unavailable, no `mediaDevices` → unsupported).
  - `class MicError extends Error { kind }`
  - `startRecording(ctx, source, { maxSeconds = 30, onAutoStop }): Promise<{ stop(): Float32Array }>` — loads `recorder-worklet.js` once per context (`new URL('./recorder-worklet.js', import.meta.url)`), appends chunks to a clip of `maxSeconds * ctx.sampleRate`; calls `onAutoStop(samples)` when full. `stop()` disconnects and returns the samples; calling it twice is safe.
- Worklet: processor name `'clip-recorder'`; posts a copy of channel 0 each `process()` call; returns `true`.

- [ ] **Step 1: Implement both files.** Browser-only; behavior is verified in Task 6/7 against a real mic.
- [ ] **Step 2: Run `npm test`** — Expected: existing tests still PASS (no Node imports of these files).
- [ ] **Step 3: Commit** `feat: mic capture and worklet recorder`

---

### Task 6: Page shell, live waterfall, error states

**Files:**
- Create: `index.html`, `src/live.js`, `src/app.js`, `.claude/launch.json`

**Interfaces:**
- Consumes: `startMic`, `MicError`, `startRecording` (Task 5); `colormapLut`, `paintColumn` (Task 3).
- Produces:
  - `createLiveView(canvas: HTMLCanvasElement, analyser: AnalyserNode, getOpts: () => {floorDb, ceilDb, scale, lut}): { start(), stop(), clear() }` — each animation frame: `getFloatFrequencyData`, shift canvas left 1 px (`drawImage` onto itself), `paintColumn` at the right edge, adding `sampleRate: analyser.context.sampleRate` to the opts. Re-reads `analyser.frequencyBinCount` every frame so FFT size changes apply on the next frame.
  - `app.js` holds state `{ mic, recording, clip }` and owns all buttons.
- `launch.json`: name `spectrokey`, `python -m http.server 8000`, port 8000.

Layout: live canvas on top (full width, ~45% height), controls row (Start mic, Record/Stop, Clear, FFT size select, Linear/Log toggle, dB floor & ceiling sliders, colormap select), analysis panel below (filled in Task 7). Frequency axis labels on the left of each canvas. Status line for notices. Light/dark via `prefers-color-scheme`; works at 375 px width.

- [ ] **Step 1: Build the page and live view.**
- [ ] **Step 2: Preview** with `preview_start` (`spectrokey`), click Start mic, play a 1 kHz tone (e.g. an online tone generator on another device, or whistle). Expected: a bright horizontal line scrolls at the 1 kHz label; switching to Log moves it and keeps it aligned with the axis label.
- [ ] **Step 3: Check error states.** Deny mic permission → inline message "Microphone access was blocked" with a Retry button; canvas not blank-and-silent. Check console for errors: none.
- [ ] **Step 4: Check double-click safety** (Review Focus 5). Start mic twice → still one stream (`state.mic.stream.getTracks().length === 1`); Record is disabled until the mic runs; Record toggles to Stop while recording. Dragging floor slider past ceiling stops at ceiling − 1.
- [ ] **Step 5: Run `npm test`** — Expected: PASS.
- [ ] **Step 6: Commit** `feat: live spectrogram page`

---

### Task 7: Analysis panel and exports

**Files:**
- Create: `src/analysis.js`
- Modify: `src/app.js`, `index.html`

**Interfaces:**
- Consumes: `stft` (Task 2); `paintColumn`, `rowToHz`, `colormapLut` (Task 3); `encodeWav` (Task 4).
- Produces:
  - `createAnalysisView(canvas, readoutEl): { show(samples: Float32Array, sampleRate: number, opts), rerender(opts), resetZoom(), exportPng(): void, exportWav(): void }`
  - `show` computes `stft(samples, opts.fftSize, opts.fftSize/4)` and paints one canvas column per frame (canvas width = frame count, CSS-scaled to panel width). Zoom: drag horizontally to select a time range, re-render only those frames at full panel width; double-click resets.
  - Hover readout: `t = 1.23 s · f = 1,000 Hz · −24.5 dB` from pointer x/y via frame index × hop / sampleRate and `rowToHz`.
  - Exports: PNG via `canvas.toBlob`, WAV via `encodeWav`; download as `spectrokey-<ISO time>.png|.wav`.
  - Empty clip (`length === 0`) → panel shows "Nothing recorded" and exports stay disabled.

- [ ] **Step 1: Implement and wire** Record→Stop and auto-stop (`onAutoStop`) to `show`; display knob changes call `rerender`. Auto-stop shows "Recording stopped at 30 s limit."
- [ ] **Step 2: Preview check.** Record a 1 kHz tone for 3 s → static spectrogram with a line at 1 kHz; hover over it reads ≈1,000 Hz and t within the clip. Drag-zoom shows the selected range; double-click resets. PNG and WAV download and the WAV plays back.
- [ ] **Step 3: Edge checks.** Record → Stop immediately → one padded column drawn, no error (Review Focus 2). Record for 31 s → auto-stops at 30 s with the notice.
- [ ] **Step 4: Run `npm test`** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: recorded clip analysis and exports`

---

### Task 8: Publish as Artifact

**Files:**
- No source changes expected (adjust `index.html` only if the hosted page needs it).

- [ ] **Step 1: Load the `artifact-capabilities` skill** to declare microphone access, and `artifact-design` for the page contract (title, tokens, theming).
- [ ] **Step 2: Publish** `index.html` with `files` mapping every `src/*.js` at the same relative paths.
- [ ] **Step 3: Verify the published page** in the browser pane: mic prompt appears, live view runs, a recording renders and exports.
- [ ] **Step 4: Commit** any adjustments `chore: publish artifact`
