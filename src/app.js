// Page wiring: mic, recording, controls, axis labels, error states.
import { startMic, MicError, startRecording } from './audio.js';
import { colormapLut, rowToHz } from './render.js';
import { createLiveView } from './live.js';
import { createAnalysisView } from './analysis.js';
import { wireEcho } from './echo.js';

const MAX_SECONDS = 30;
const $ = (id) => document.getElementById(id);

const state = { mic: null, recording: null, clip: null };

const el = {
  live: $('live-canvas'), analysisCanvas: $('analysis-canvas'),
  liveAxis: $('live-axis'), analysisAxis: $('analysis-axis'),
  overlay: $('live-overlay'), overlayMsg: $('live-overlay-msg'), retry: $('retry'),
  start: $('start'), record: $('record'), clear: $('clear'),
  fft: $('fft'), scale: $('scale'), colormap: $('colormap'),
  floor: $('floor'), ceil: $('ceil'), floorOut: $('floor-out'), ceilOut: $('ceil-out'),
  status: $('status'), readout: $('readout'),
  exportPng: $('export-png'), exportWav: $('export-wav'),
};

const ERRORS = {
  denied: "Microphone access was blocked. Allow it in your browser's site settings, then Retry.",
  unavailable: 'No usable microphone was found.',
  unsupported: "This browser can't record audio.",
};
const INSECURE = 'Microphone needs HTTPS (or localhost).';

// Let the browser paint (e.g. an "Analyzing…" status) before heavy synchronous work.
function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
let recordToken = 0; // newest recording wins if several are queued
let fftToken = 0; // newest FFT-size change wins

let lut = colormapLut(el.colormap.value);
let view = null;
const analysis = createAnalysisView(el.analysisCanvas, el.readout, (msg) => setStatus(msg, true));
let starting = false;

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.classList.toggle('error', isError);
}

function getOpts() {
  return {
    floorDb: Number(el.floor.value), ceilDb: Number(el.ceil.value),
    scale: el.scale.value, lut, fftSize: Number(el.fft.value),
  };
}

// --- canvas sizing and axis labels ---
function sampleRate() { return state.mic ? state.mic.ctx.sampleRate : 48000; }

function safeRerender() {
  if (!state.clip) return;
  try {
    analysis.rerender(getOpts());
  } catch (err) {
    console.error(err);
    setStatus('Could not draw the recording.', true);
  }
}

function drawAxis(axisEl, canvas, sr) {
  const h = canvas.height;
  const nyquist = sr / 2;
  const log = el.scale.value === 'log';
  const marks = log
    ? [100, 500, 1000, 2000, 5000, 10000, 20000]
    : [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((f * nyquist) / 100) * 100);
  axisEl.textContent = '';
  if (!h) return;
  for (const hz of marks) {
    if (hz > nyquist || (log && hz < 20)) continue;
    // Find the row whose frequency is closest to hz (rowToHz decreases with row).
    let lo = 0, hi = h - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rowToHz(mid, h, sr, el.scale.value) > hz) lo = mid + 1; else hi = mid;
    }
    const span = document.createElement('span');
    span.textContent = hz >= 1000 ? `${hz / 1000}k` : String(hz);
    span.style.top = `${((lo + 0.5) / h) * 100}%`;
    axisEl.appendChild(span);
  }
}

function sizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
  }
}

function drawAxes() {
  drawAxis(el.liveAxis, el.live, sampleRate());
  drawAxis(el.analysisAxis, el.analysisCanvas, state.clip ? state.clip.sampleRate : sampleRate());
}
function layout() {
  sizeCanvas(el.live);
  safeRerender();
  drawAxes();
}

// --- overlay / errors ---
function showOverlay(message, canRetry) {
  el.overlayMsg.textContent = message;
  el.retry.hidden = !canRetry;
  el.overlay.hidden = false;
}
function hideOverlay() { el.overlay.hidden = true; }

function showMicError(err) {
  const kind = err instanceof MicError ? err.kind : 'unavailable';
  const msg = kind === 'unsupported' && window.isSecureContext === false
    ? INSECURE
    : ERRORS[kind] || ERRORS.unavailable;
  showOverlay(msg, kind !== 'unsupported');
  setStatus(msg, true);
}

// --- mic ---
async function onStart() {
  if (state.mic || starting) return;
  starting = true;
  el.start.disabled = true;
  hideOverlay();
  setStatus('Starting microphone...');
  try {
    const { ctx, source, stream } = await startMic();
    const analyser = ctx.createAnalyser();
    analyser.smoothingTimeConstant = 0;
    analyser.minDecibels = -120;
    analyser.maxDecibels = 0;
    analyser.fftSize = Number(el.fft.value);
    source.connect(analyser); // not connected to destination: no audible output
    state.mic = { ctx, source, stream, analyser };
    view = createLiveView(el.live, analyser, getOpts);
    view.start();
    el.start.textContent = 'Mic on';
    el.record.disabled = false;
    drawAxes();
    setStatus('Listening.');
  } catch (err) {
    el.start.disabled = false;
    showMicError(err);
  } finally {
    starting = false;
  }
}

// --- recording ---
async function finishRecording(samples, autoStopped = false) {
  state.recording = null;
  const sampleRate = state.mic.ctx.sampleRate;
  state.clip = { samples, sampleRate };
  el.record.textContent = 'Record';
  const hasAudio = samples.length > 0;
  el.exportPng.disabled = !hasAudio;
  el.exportWav.disabled = !hasAudio;
  const token = ++recordToken;
  if (hasAudio) {
    setStatus('Analyzing…');
    await nextPaint();
    if (token !== recordToken) return; // a newer recording took over
  }
  try {
    analysis.show(samples, sampleRate, getOpts());
  } catch (err) {
    console.error(err);
    drawAxes();
    setStatus('Could not draw the recording.', true);
    return;
  }
  drawAxes();
  if (autoStopped) setStatus(`Recording stopped at ${MAX_SECONDS} s limit.`);
  else setStatus(`Recorded ${(samples.length / sampleRate).toFixed(1)} s`);
}

async function onRecord() {
  if (!state.mic) return;
  if (state.recording) {
    finishRecording(state.recording.stop());
    return;
  }
  el.record.disabled = true;
  try {
    const rec = await startRecording(state.mic.ctx, state.mic.source, {
      maxSeconds: MAX_SECONDS,
      onAutoStop: (samples) => finishRecording(samples, true),
    });
    state.recording = rec;
    el.record.textContent = 'Stop';
    setStatus('Recording...');
  } catch (err) {
    console.error(err);
    setStatus('Could not start recording.', true);
  } finally {
    el.record.disabled = false;
  }
}

// --- controls ---
el.start.addEventListener('click', onStart);
el.retry.addEventListener('click', onStart);
el.record.addEventListener('click', onRecord);
el.clear.addEventListener('click', () => {
  if (view) { view.clear(); return; }
  const c = el.live.getContext('2d');
  c.fillStyle = '#000';
  c.fillRect(0, 0, el.live.width, el.live.height);
});
el.fft.addEventListener('change', async () => {
  if (state.mic) state.mic.analyser.fftSize = Number(el.fft.value);
  if (!state.clip || !state.clip.samples.length) { safeRerender(); return; }
  // A new FFT size reruns the STFT: show progress first.
  const token = ++fftToken;
  const prev = { text: el.status.textContent, error: el.status.classList.contains('error') };
  setStatus('Analyzing…');
  await nextPaint();
  if (token !== fftToken) return;
  setStatus(prev.text, prev.error);
  safeRerender();
});
el.scale.addEventListener('change', () => {
  safeRerender();
  drawAxes();
});
el.colormap.addEventListener('change', () => {
  lut = colormapLut(el.colormap.value);
  safeRerender();
});
el.exportPng.addEventListener('click', () => analysis.exportPng());
el.exportWav.addEventListener('click', () => analysis.exportWav());

function onDb(moved) {
  let floor = Number(el.floor.value);
  let ceil = Number(el.ceil.value);
  if (floor > ceil - 1) {
    if (moved === 'floor') floor = ceil - 1; else ceil = floor + 1;
    el.floor.value = floor;
    el.ceil.value = ceil;
  }
  el.floorOut.textContent = el.floor.value;
  el.ceilOut.textContent = el.ceil.value;
  safeRerender();
}
el.floor.addEventListener('input', () => onDb('floor'));
el.ceil.addEventListener('input', () => onDb('ceil'));

wireEcho($('echo-in'), $('echo-out'));

window.addEventListener('resize', layout);
layout();
if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  el.start.disabled = true;
  showMicError(new MicError('unsupported', ''));
}

export { state };
