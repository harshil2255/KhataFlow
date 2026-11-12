"use client";

import React, { useEffect, useRef } from "react";
import { 
  Activity, 
  Terminal, 
  Mic, 
  ShieldCheck, 
  CheckCircle, 
  Clock, 
  Volume2, 
  Radio,
  FileCode2
} from "lucide-react";

interface LiveVisualizerProps {
  isRecording: boolean;
  transcript: string;
  isFinalTranscript: boolean;
  extractedPayload: unknown;
  ttfaLatencyMs: number | null;
  waveformData: Uint8Array | null;
  spokenAudioPlaying: boolean;
  onSimulateSpeech: (text: string) => void;
  sttSource?: string | null;
  sttMessage?: string | null;
}

export const LiveVisualizer: React.FC<LiveVisualizerProps> = ({
  isRecording,
  transcript,
  isFinalTranscript,
  extractedPayload,
  ttfaLatencyMs,
  waveformData,
  spokenAudioPlaying,
  onSimulateSpeech,
  sttSource,
  sttMessage,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Render real-time oscilloscope audio waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Background grid
    ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (!waveformData || !isRecording) {
      // Idle straight neon line
      ctx.beginPath();
      ctx.strokeStyle = "rgba(16, 185, 129, 0.3)";
      ctx.lineWidth = 2;
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      return;
    }

    // Dynamic wave
    ctx.beginPath();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#10b981"; // emerald-500
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#10b981";

    const sliceWidth = (width * 1.0) / waveformData.length;
    let x = 0;

    for (let i = 0; i < waveformData.length; i++) {
      const v = waveformData[i] / 128.0;
      const y = (v * height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.shadowBlur = 0; // reset
  }, [waveformData, isRecording]);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Bar / Judge Monitor Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/40 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Terminal className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            Judge Live Demo Visualizer
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-800 text-[11px] text-emerald-300 font-medium">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span>Gnani Prisma v3 + Groq Llama-3.1</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Real-Time Latency Benchmark Card */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-yellow-400" /> Real-Time Latency Benchmark
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700">
              Target: &lt; 1500 ms
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-3">
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Time-to-First-Audio</span>
              <div className="text-xl font-mono font-extrabold text-emerald-400 mt-1 flex items-baseline gap-1">
                {ttfaLatencyMs !== null ? `${ttfaLatencyMs}` : "---"}
                <span className="text-xs font-sans text-slate-400 font-normal">ms</span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Status</span>
              <div className="text-sm font-bold mt-1.5 flex items-center gap-1">
                {ttfaLatencyMs !== null && ttfaLatencyMs < 1500 ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle className="h-4 w-4" /> ULTRA LOW
                  </span>
                ) : ttfaLatencyMs !== null ? (
                  <span className="text-yellow-400">ACCEPTABLE</span>
                ) : (
                  <span className="text-slate-500">STANDBY</span>
                )}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800/80">
              <span className="text-[10px] uppercase font-bold text-slate-500 block">Spoken Audio Playback</span>
              <div className="text-sm font-bold mt-1.5 flex items-center gap-1">
                {spokenAudioPlaying ? (
                  <span className="text-emerald-400 flex items-center gap-1.5 animate-pulse">
                    <Volume2 className="h-4 w-4" /> PLAYING
                  </span>
                ) : (
                  <span className="text-slate-500 flex items-center gap-1.5">
                    <Radio className="h-4 w-4" /> IDLE
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Live Audio Waveform (Oscilloscope) */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-emerald-400" /> AudioWorklet 16kHz PCM Stream
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  isRecording ? "bg-red-500 animate-ping" : "bg-slate-600"
                }`}
              />
              <span className="text-[11px] font-mono text-slate-400">
                {isRecording ? "MIC STREAMING ACTIVE" : "MIC STANDBY"}
              </span>
            </div>
          </div>
          <div className="w-full bg-slate-950 rounded-lg p-2 border border-slate-800">
            <canvas
              ref={canvasRef}
              width={540}
              height={80}
              className="w-full h-20 rounded"
            />
          </div>
        </div>

        {/* Real-time Streaming Transcript Feed */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Mic className="h-3.5 w-3.5 text-blue-400" /> Live STT Feed
            </span>
            <div className="flex items-center gap-2">
              {sttSource && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider border ${
                    sttSource === "simulated"
                      ? "bg-yellow-950 text-yellow-300 border-yellow-800"
                      : sttSource === "demo"
                      ? "bg-purple-950 text-purple-300 border-purple-800"
                      : sttSource === "vosk"
                      ? "bg-emerald-950 text-emerald-300 border-emerald-800"
                      : "bg-slate-800 text-slate-300 border-slate-700"
                  }`}
                >
                  {sttSource === "simulated"
                    ? "Simulated (no STT key)"
                    : sttSource === "vosk"
                    ? "Vosk · Offline"
                    : sttSource === "groq_whisper"
                    ? "Groq Whisper"
                    : sttSource}
                </span>
              )}
              {transcript && (
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                    isFinalTranscript
                      ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                      : "bg-blue-950 text-blue-300 border border-blue-800 animate-pulse"
                  }`}
                >
                  {isFinalTranscript ? "Final Frame" : "Streaming Interim"}
                </span>
              )}
            </div>
          </div>
          <div className="min-h-[56px] p-3 rounded-lg bg-slate-950 border border-slate-800/80 font-mono text-xs text-slate-200">
            {transcript ? (
              <span>&ldquo;{transcript}&rdquo;</span>
            ) : (
              <span className="text-slate-600 italic">
                Awaiting voice input or simulated speech click below...
              </span>
            )}
          </div>
          {sttMessage && (
            <p className="mt-2 text-[11px] text-yellow-400">{sttMessage}</p>
          )}
        </div>

        {/* Extracted JSON Payload Viewer */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <FileCode2 className="h-3.5 w-3.5 text-purple-400" /> Extracted Intent JSON Payload (Groq LLM)
            </span>
            <span className="text-[10px] font-mono text-purple-300 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800/60">
              llama-3.1-70b-versatile
            </span>
          </div>
          <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/80 max-h-52 overflow-y-auto font-mono text-xs text-emerald-400">
            {extractedPayload ? (
              <pre className="whitespace-pre-wrap">{JSON.stringify(extractedPayload, null, 2)}</pre>
            ) : (
              <span className="text-slate-600 italic">No structured intent parsed yet.</span>
            )}
          </div>
        </div>

        {/* Quick Indic Test Scenarios for Judges & Demonstrations */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2.5">
            Judge Quick Test Inputs (Multi-Action & Indic Speech)
          </span>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <button
              onClick={() =>
                onSimulateSpeech("Ramesh ka 350 udhaar, kal 200 diya tha")
              }
              className="p-2.5 text-left rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition"
            >
              <span className="text-[10px] text-emerald-400 font-bold block">1. Multi-Action (Hinglish)</span>
              &ldquo;Ramesh ka 350 udhaar, kal 200 diya tha&rdquo;
            </button>

            <button
              onClick={() =>
                onSimulateSpeech("पूजा ने 200 रुपये का मैदा खरीदा, 50 रुपये की Maggi खरीदी। उधार में डाल दो, तो total को calculate करके।")
              }
              className="p-2.5 text-left rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition"
            >
              <span className="text-[10px] text-emerald-400 font-bold block">2. Itemized Kirana Bill Totaling (₹250)</span>
              &ldquo;पूजा ने 200 मैदा, 50 Maggi... total calculate करके उधार&rdquo;
            </button>

            <button
              onClick={() => onSimulateSpeech("Nahi 350 nahi, 430 tha")}
              className="p-2.5 text-left rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition"
            >
              <span className="text-[10px] text-yellow-400 font-bold block">3. Spoken Correction</span>
              &ldquo;Nahi 350 nahi, 430 tha&rdquo;
            </button>

            <button
              onClick={() =>
                onSimulateSpeech("Ramesh ka total kitna baaki hai?")
              }
              className="p-2.5 text-left rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 transition"
            >
              <span className="text-[10px] text-blue-400 font-bold block">4. Customer Balance Query</span>
              &ldquo;Ramesh ka total kitna baaki hai?&rdquo;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
