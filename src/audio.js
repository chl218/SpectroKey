// Browser-only: microphone capture and raw-sample recording via an AudioWorklet.
import { createClip } from './clip.js';

export class MicError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'MicError';
    this.kind = kind; // 'denied' | 'unavailable' | 'unsupported'
  }
}

// Ask for the mic and return the live audio graph's first nodes.
export async function startMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new MicError('unsupported', 'This browser cannot access a microphone.');
  }
  const ctx = new AudioContext();
  let stream;
  try {
    // Turn off voice processing so the spectrogram shows the real signal.
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (err) {
    ctx.close().catch(() => {});
    const denied = err && err.name === 'NotAllowedError';
    throw new MicError(
      denied ? 'denied' : 'unavailable',
      denied ? 'Microphone permission was denied.' : 'No usable microphone was found.'
    );
  }
  try {
    await ctx.resume(); // contexts may start suspended until a user gesture
    const source = ctx.createMediaStreamSource(stream);
    return { ctx, source, stream };
  } catch (err) {
    // Release the mic and the context so nothing stays live after a failure.
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
    throw new MicError('unavailable', 'Could not start audio capture.');
  }
}

// addModule should run once per context, even for concurrent calls.
const workletLoads = new WeakMap();
function loadWorklet(ctx) {
  let p = workletLoads.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url))
      .catch((e) => { workletLoads.delete(ctx); throw e; }); // allow a retry after failure
    workletLoads.set(ctx, p);
  }
  return p;
}

// On failure this throws and leaves ctx/stream untouched and unconnected; the caller owns them.
// Record mic samples into a clip. stop() returns them; onAutoStop fires if the clip fills first.
export async function startRecording(ctx, source, { maxSeconds = 30, onAutoStop } = {}) {
  await loadWorklet(ctx);

  const clip = createClip(Math.round(maxSeconds * ctx.sampleRate));
  const node = new AudioWorkletNode(ctx, 'clip-recorder');
  // A silent gain node routes the worklet to the output so the engine keeps pulling audio through it.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  try {
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
  } catch (err) {
    // Undo any partial wiring before rethrowing.
    try { source.disconnect(node); } catch {}
    node.disconnect();
    mute.disconnect();
    throw err;
  }

  let samples = null; // set once stopped

  function stop() {
    if (samples) return samples;
    node.port.onmessage = null;
    source.disconnect(node);
    node.disconnect();
    mute.disconnect();
    samples = clip.toFloat32();
    return samples;
  }

  node.port.onmessage = (e) => {
    if (samples) return;
    if (clip.append(e.data)) {
      const result = stop();
      if (onAutoStop) onAutoStop(result);
    }
  };

  return { stop };
}
