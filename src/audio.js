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
    ctx.close();
    const denied = err && err.name === 'NotAllowedError';
    throw new MicError(
      denied ? 'denied' : 'unavailable',
      denied ? 'Microphone permission was denied.' : 'No usable microphone was found.'
    );
  }
  await ctx.resume(); // contexts may start suspended until a user gesture
  const source = ctx.createMediaStreamSource(stream);
  return { ctx, source, stream };
}

// addModule should run once per context, even for concurrent calls.
const workletLoads = new WeakMap();
function loadWorklet(ctx) {
  let p = workletLoads.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));
    workletLoads.set(ctx, p);
  }
  return p;
}

// Record mic samples into a clip. stop() returns them; onAutoStop fires if the clip fills first.
export async function startRecording(ctx, source, { maxSeconds = 30, onAutoStop } = {}) {
  await loadWorklet(ctx);

  const clip = createClip(Math.round(maxSeconds * ctx.sampleRate));
  const node = new AudioWorkletNode(ctx, 'clip-recorder');
  // A silent gain node routes the worklet to the output so the engine keeps pulling audio through it.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);

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
