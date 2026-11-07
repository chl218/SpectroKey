# Spectrogram App — Design

**Date:** 2026-11-06
**Status:** Approved design, pre-implementation

## Purpose & success criteria

A single-page browser app that records sound from the microphone and
displays it as a spectrogram. It serves three goals at once, confirmed with
the user:

- **A. Live visual instrument** — make noise, watch frequencies evolve in
  real time.
- **B. Analysis tool** — record a clip, study it closely (zoom, read off
  time/frequency/dB), export the image and the audio.
- **C. Learning/demo** — the DSP (windowing, FFT, dB mapping) stays readable
  and inspectable, not hidden behind a library.

Success looks like: open the page, allow the mic, immediately see a smooth
scrolling spectrogram of live sound; hit record, get a crisp static
spectrogram of the clip that you can hover and export.

## Platform decision

**Browser, single self-contained HTML page**, shipped as an Artifact. No
build step, no external libraries.

Rationale: the browser delivers all three goals with the least friction —
Web Audio gives real-time FFT for free (A), an in-memory buffer plus a
from-scratch STFT covers recording and analysis (B), and the math can be
written out plainly in small functions (C). Trade-off accepted: the **live**
view uses the browser's built-in `AnalyserNode` FFT (the only way to get
smooth real-time performance), while the **offline** high-res render uses our
own FFT so the math is fully visible. This split is intentional, not an
inconsistency.

## Layout

Scrolling "waterfall": frequency on the vertical axis, time scrolling
right-to-left like a seismograph, live at the top. A **Record** control
freezes a clip into a lower panel for analysis.

## Architecture

One HTML page; logic split into small named units (plain functions/objects
in one file), each with one clear job:

- **`audio`** — `getUserMedia` for the mic; owns the single `AudioContext`.
- **`liveAnalyser`** — wraps an `AnalyserNode`; pulls one FFT frame per
  animation frame (~60/sec) for the live view.
- **`recorder`** — an `AudioWorklet` that copies raw Float32 samples into a
  buffer while armed. **Capped at 30 s** to bound memory; auto-stops at the
  cap with a notice.
- **`dsp`** — the from-scratch, fully-commented math: Hann window, radix-2
  Cooley–Tukey FFT (power-of-2 window; zero-pad as needed), magnitude→dB.
  Used for the offline render and the unit tests.
- **`render`** — maps a column of dB values to colors (viridis-style
  colormap lookup) and paints canvas columns.
- **`ui`** — wires buttons/sliders to the above.

Boundaries: `dsp` is pure (numbers in, numbers out) and has no knowledge of
canvas or audio; `render` knows colors and pixels but not audio; `audio`/
`recorder` know capture but not display. Each can be understood and changed
without reading the others.

## Data flow

**Live:** mic → `AnalyserNode` → each animation frame read one FFT frame →
`render` maps it to a 1px-wide colored column → draw at the right edge and
scroll the existing image one pixel left.

**Record → analyze:** while recording, `recorder` accumulates samples. On
stop, the clip appears in the lower panel: `dsp` runs an **STFT** (slide the
Hann window across the samples with overlap, FFT each window) to produce a
crisp static spectrogram of the whole clip. Hovering reads out **time /
frequency / dB** at the cursor.

## Controls

- **Live:** Start mic, Record / Stop, Clear.
- **Shared display knobs:** FFT size (512–8192), frequency scale (linear /
  log), dB range floor + ceiling (contrast), colormap.
- **Analysis panel:** zoom (drag to select a region), export PNG (the
  spectrogram image), export WAV (the recorded audio).

## Error handling

- Mic denied or unavailable → clear inline message with a retry button; the
  canvas is never a silent dead rectangle.
- No mic present → handled, no crash.
- Recording reaches the 30 s cap → auto-stop with a visible notice.
- FFT size changes mid-session → applied on the next frame; no crash.

## Testing

The pure `dsp` functions are the testable core:

- **FFT correctness:** a pure sine at a bin-centered frequency lands in a
  single bin; a DC signal lands in bin 0; impulse → flat magnitude.
- **Windowing:** Hann window endpoints are ~0 and center is 1.
- **dB conversion:** known magnitude → expected dB; floor clamping works.

These run as plain JS assertions (a small test page or inline test block).
The audio/canvas glue is validated by running the app in the browser preview
and confirming a played tone appears at the correct frequency line.

## Out of scope (YAGNI)

- File upload / analyzing pre-existing audio files (mic only for now).
- Multi-channel / stereo display (mono mix).
- Persisting sessions, accounts, or sharing beyond the exported files.
- Note/pitch detection or labeling.
