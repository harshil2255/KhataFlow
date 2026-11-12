// AudioWorklet processor that converts incoming Float32 microphone audio
// into 16-bit signed little-endian Linear PCM chunks for WebSocket streaming.
//
// NOTE: an AudioWorkletNode is only pulled by the audio graph when it reaches
// the AudioContext destination. The recorder connects this node through a
// zero-gain sink so `process()` actually runs (otherwise no chunks are emitted).

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 1024 samples @ 16kHz = 64ms per WebSocket frame. Small enough for low
    // latency, large enough to avoid flooding the socket.
    this.frameSize = 1024;
    this.buffer = new Int16Array(this.frameSize);
    this.offset = 0;

    // Allow the main thread to flush the remaining tail samples on stop.
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  flush() {
    if (this.offset === 0) return;
    const chunk = this.buffer.slice(0, this.offset);
    this.port.postMessage(chunk.buffer, [chunk.buffer]);
    this.buffer = new Int16Array(this.frameSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channelData = input && input[0];
    if (!channelData || channelData.length === 0) return true;

    for (let i = 0; i < channelData.length; i++) {
      // Clamp float sample [-1.0, 1.0] to signed 16-bit range.
      const s = Math.max(-1, Math.min(1, channelData[i]));
      this.buffer[this.offset++] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);

      if (this.offset >= this.frameSize) {
        this.flush();
      }
    }

    return true;
  }
}

registerProcessor("pcm-recorder-processor", PCMProcessor);
