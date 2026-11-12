/**
 * AudioWorklet PCM Recorder wrapper.
 * Captures microphone audio, runs the AudioWorklet processor, and passes
 * 16-bit signed little-endian PCM chunks to the callback for low-latency
 * WebSocket transmission.
 */

export class PCMAudioRecorder {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private silentGain: GainNode | null = null;
  private onAudioChunk: ((chunk: ArrayBuffer) => void) | null = null;
  private onWaveformData: ((data: Uint8Array) => void) | null = null;
  private animFrameId: number | null = null;
  private stopping = false;

  /** AudioContext sample rate actually granted by the browser (normally 16000). */
  get sampleRate(): number {
    return this.audioContext?.sampleRate ?? 0;
  }

  async start(
    onChunk: (chunk: ArrayBuffer) => void,
    onWaveform?: (data: Uint8Array) => void
  ): Promise<void> {
    this.onAudioChunk = onChunk;
    this.onWaveformData = onWaveform || null;
    this.stopping = false;

    // Use 16kHz audio context for telephony/Gnani STT standard. Browsers that
    // do not support a custom rate will fall back to the hardware rate, which
    // is reported via `sampleRate` so the backend can build a correct WAV.
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioContextClass({ sampleRate: 16000 });

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    // Load custom AudioWorklet processor
    await this.audioContext.audioWorklet.addModule("/pcm-processor.js");

    // Acquire microphone permissions. Do not force sampleRate here: browsers
    // reject unsupported constraints and the AudioContext already resamples.
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // Analyser for the real-time oscilloscope visualizer
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;

    this.workletNode = new AudioWorkletNode(this.audioContext, "pcm-recorder-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });

    this.workletNode.port.onmessage = (event) => {
      const data = event.data;
      if (data instanceof ArrayBuffer && this.onAudioChunk) {
        this.onAudioChunk(data);
      }
    };

    // CRITICAL: route mic -> analyser -> worklet -> silent gain -> destination.
    // A worklet that never reaches the destination is not pulled by Chrome and
    // never emits PCM, which was the root cause of "mic records but server
    // receives nothing".
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;

    this.sourceNode.connect(this.analyserNode);
    this.analyserNode.connect(this.workletNode);
    this.workletNode.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);

    // Start waveform animation loop
    if (this.onWaveformData) {
      this.startWaveformLoop();
    }
  }

  private startWaveformLoop() {
    if (!this.analyserNode) return;
    const bufferLength = this.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const update = () => {
      if (!this.analyserNode || !this.onWaveformData) return;
      this.analyserNode.getByteTimeDomainData(dataArray);
      this.onWaveformData(dataArray);
      this.animFrameId = requestAnimationFrame(update);
    };

    this.animFrameId = requestAnimationFrame(update);
  }

  /**
   * Stops capture. Returns once the worklet has flushed its remaining tail
   * samples (or after a short timeout) so the last word is not dropped.
   */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    const node = this.workletNode;
    if (node) {
      try {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 120);
          const previousHandler = node.port.onmessage;
          node.port.onmessage = (event) => {
            const data = event.data;
            if (data instanceof ArrayBuffer) {
              this.onAudioChunk?.(data);
              return;
            }
            if (data && data.type === "flushed") {
              clearTimeout(timeout);
              node.port.onmessage = previousHandler;
              resolve();
            }
          };
          node.port.postMessage({ type: "flush" });
        });
      } catch {
        // Ignore flush failures; teardown continues below.
      }
    }

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.silentGain) {
      this.silentGain.disconnect();
      this.silentGain = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // Already closed.
      }
      this.audioContext = null;
    }

    this.onAudioChunk = null;
    this.onWaveformData = null;
  }
}
