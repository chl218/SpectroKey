// Runs on the audio thread. Sends a copy of each 128-frame block (channel 0) to the main thread.
class ClipRecorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // The engine reuses its buffers, so copy before posting.
    if (channel) this.port.postMessage(channel.slice());
    return true; // keep the processor alive
  }
}

registerProcessor('clip-recorder', ClipRecorder);
