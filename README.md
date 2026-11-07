# SpectroKey

A spectrogram in your browser. Watch your microphone as a live, scrolling
picture of frequencies, record a clip of up to 30 seconds, then study it:
hover for exact time/frequency/level, zoom in, and export the image or the
audio.

No installs, no libraries, no build step — plain HTML and JavaScript modules.

## Running it

The page needs to be served over `http://localhost` (or HTTPS) — browsers only
allow microphone access on secure origins, and ES modules don't load from
`file://`.

From this folder, start the bundled dev server:

```bash
python scripts/serve.py
```

(or `npm run serve`; add `--port 9000` for a different port). Then open
<http://localhost:8000> and click **Start mic**. Allow microphone access when
the browser asks.

The dev server is deliberately locked down. It listens on `127.0.0.1` only, serves
just this folder, shows no directory listings, never serves hidden paths
such as `.git`, and rejects requests whose `Host` isn't localhost (which
stops DNS-rebinding pages from reading your files). Prefer it over
`python -m http.server`, which lists directories, serves `.git`, and
listens on every network interface.

## Using it

The top canvas is the **live view**: frequency (Hz) runs up the left side from
0 to 10,000 Hz, and time scrolls right to left, newest on the right.
Brighter = louder. Both views stop at 10 kHz, where almost all speech and
music energy sits. On a device whose sample rate is below 20 kHz, the top
is the highest frequency it can capture.

| Control | What it does |
|---|---|
| **Start mic** | Starts listening. Shows "Mic on" while running. |
| **Record / Stop** | Records the microphone. Stops on its own after 30 s. |
| **Clear** | Wipes the live view. |
| **FFT** | Window size, 512–8192. Larger = finer frequency detail, coarser time detail. |
| **Scale** | Linear (0–10,000 Hz) or Log (20–10,000 Hz) frequency axis. Log spreads out the low end, which suits voice and music. |
| **Colormap** | viridis, magma, or gray. |
| **Floor / Ceiling** | The dB range mapped to dark → bright. Raise the floor to hide background noise; lower the ceiling to bring out quiet sounds. 0 dB is a full-scale sine wave. |

The display controls apply to both the live view and the recorded clip.

Below the controls, the **Echo** box repeats whatever you type in the
**Output** box beneath it, as you type it. Press **Enter** to clear the box; Output keeps
showing the last line. The text stays on the page: it isn't saved, sent
anywhere, or tied to recordings.

### Studying a recording

After you stop recording, the clip appears in the lower panel, with time in
seconds along the bottom.

- **Hover** to read the time, frequency, and level under the cursor, e.g.
  `t = 1.45 s · f = 1,027 Hz · −6.2 dB`.
- **Drag** left or right across the panel to zoom into that stretch of time.
  **Double-click** to zoom back out.
- **Export PNG** saves the spectrogram as shown (including any zoom).
- **Export WAV** saves the recorded audio (16-bit mono).

### If the microphone doesn't start

- *"Microphone access was blocked"* — allow the microphone for this site in your
  browser's site settings, then click **Retry**.
- *"No usable microphone was found"* — plug one in or check that no other app
  has exclusive use of it, then **Retry**.
- *"Microphone needs HTTPS (or localhost)"* — you opened the page from another
  address over plain http; use localhost or serve it over HTTPS.

## How it works

- **Live view:** the browser's `AnalyserNode` computes an FFT each animation
  frame; each frame becomes one new pixel column.
- **Recorded clip:** an `AudioWorklet` captures raw samples; SpectroKey then
  runs its own short-time Fourier transform — Hann window, 75% overlap, and a
  from-scratch radix-2 FFT in [`src/dsp.js`](src/dsp.js), commented for anyone
  learning how spectrograms are made.
- Both views use the same dB reference, so the same Floor/Ceiling settings look
  the same in each.

| File | Role |
|---|---|
| `src/dsp.js` | Hann window, FFT, dB conversion, STFT |
| `src/render.js` | Colormaps, frequency↔row mapping, painting columns |
| `src/wav.js`, `src/clip.js` | WAV encoding, 30 s capped sample buffer |
| `src/audio.js`, `src/recorder-worklet.js` | Microphone and recording |
| `src/live.js`, `src/analysis.js`, `src/app.js` | Live view, clip panel, UI wiring |
| `src/echo.js` | Echo box |
| `scripts/serve.py` | Locked-down local dev server |

## Tests

The math modules are unit-tested with Node's built-in test runner (Node 20+):

```bash
npm test
```

The dev server has its own tests (Python 3):

```bash
npm run test:server
```
