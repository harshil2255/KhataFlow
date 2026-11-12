"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { LedgerCards, Customer, Transaction } from "@/components/LedgerCards";
import { LiveVisualizer } from "@/components/LiveVisualizer";
import { PCMAudioRecorder } from "@/lib/audioRecorder";
import { Mic, MicOff } from "lucide-react";

type RecognitionResultItem = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<RecognitionResultItem>;
};
type SpeechRecognitionErrorLike = { error: string };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
};

export default function Home() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [lastUpdatedCustomerId, setLastUpdatedCustomerId] = useState<number | null>(null);

  // Voice & Recorder state
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isFinalTranscript, setIsFinalTranscript] = useState(false);
  const [extractedPayload, setExtractedPayload] = useState<Record<string, unknown> | null>(null);
  const [ttfaLatencyMs, setTtfaLatencyMs] = useState<number | null>(null);
  const [waveformData, setWaveformData] = useState<Uint8Array | null>(null);
  const [spokenAudioPlaying, setSpokenAudioPlaying] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [sttSource, setSttSource] = useState<string | null>(null);
  const [sttMessage, setSttMessage] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<PCMAudioRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Refs used inside WebSocket / recognition callbacks (avoid stale closures)
  const customersRef = useRef<Customer[]>([]);
  const recordingActiveRef = useRef(false);
  const browserSttFailedRef = useRef(false);
  const clientTranscriptCountRef = useRef(0);
  const lastFinalRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sequential audio playback queue (prevents chunks from overlapping)
  const nextPlayTimeRef = useRef(0);
  const speakingRef = useRef(false);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize Web Audio Context for playing back synthesized PCM / audio stream
  const initPlaybackContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioCtx({ sampleRate: 16000 });
    }
    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume();
    }
  }, []);

  // Decode a base64 raw 16-bit PCM chunk and schedule it after the previous one.
  const playAudioChunk = useCallback(
    (base64Data: string, sampleRate = 16000) => {
      try {
        if (!audioContextRef.current) initPlaybackContext();
        const ctx = audioContextRef.current;
        if (!ctx) return;

        const binaryString = window.atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        const sampleCount = Math.floor(len / 2);
        if (sampleCount === 0) return;
        const int16Array = new Int16Array(bytes.buffer, 0, sampleCount);
        const audioBuffer = ctx.createBuffer(1, sampleCount, sampleRate || 16000);
        const channelData = audioBuffer.getChannelData(0);
        for (let i = 0; i < sampleCount; i++) {
          channelData[i] = int16Array[i] / 32768.0;
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // Schedule strictly after the previous chunk instead of all at once.
        const startAt = Math.max(ctx.currentTime + 0.02, nextPlayTimeRef.current);
        source.start(startAt);
        nextPlayTimeRef.current = startAt + audioBuffer.duration;

        speakingRef.current = true;
        setSpokenAudioPlaying(true);
      } catch (e) {
        console.error("Audio playback error:", e);
      }
    },
    [initPlaybackContext]
  );

  const markHighlight = useCallback((customerId: number) => {
    setLastUpdatedCustomerId(customerId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setLastUpdatedCustomerId(null), 2500);
  }, []);

  useEffect(() => {
    let unmounted = false;

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws";
    const ws = new WebSocket(wsUrl);
    socketRef.current = ws;

    ws.onopen = () => {
      if (unmounted) return;
      setIsConnected(true);
      console.log("KhataFlow WebSocket connected");
    };

    ws.onmessage = (event) => {
      if (unmounted) return;
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === "INITIAL_STATE" || msg.type === "LEDGER_UPDATE") {
          const nextCustomers: Customer[] = msg.data.customers || [];
          const nextTransactions: Transaction[] = msg.data.transactions || [];

          if (msg.type === "LEDGER_UPDATE") {
            const previous = new Map(customersRef.current.map((c) => [c.id, c]));
            const changed = nextCustomers.find((c) => {
              const prev = previous.get(c.id);
              return !prev || prev.total_balance !== c.total_balance;
            });
            if (changed) markHighlight(changed.id);
          }

          customersRef.current = nextCustomers;
          setCustomers(nextCustomers);
          setTransactions(nextTransactions);
          // A ledger update means the intent pipeline completed successfully.
          setSttMessage(null);
        } else if (msg.type === "TRANSCRIPT_STREAM") {
          setTranscript(msg.transcript || "");
          setIsFinalTranscript(!!msg.is_final);
          if (msg.stt_source) setSttSource(msg.stt_source);
        } else if (msg.type === "INTENT_EXTRACTED") {
          setExtractedPayload(msg.payload);
        } else if (msg.type === "LATENCY_METRIC") {
          setTtfaLatencyMs(msg.ttfa_ms);
        } else if (msg.type === "AUDIO_RESPONSE_CHUNK") {
          initPlaybackContext();
          playAudioChunk(msg.audio_base64, msg.sample_rate || 16000);
        } else if (msg.type === "AUDIO_RESPONSE_COMPLETE") {
          // Keep "playing" true until every queued chunk has drained.
          if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
          const ctx = audioContextRef.current;
          const remainingMs = ctx ? Math.max(0, (nextPlayTimeRef.current - ctx.currentTime) * 1000) : 0;
          drainTimerRef.current = setTimeout(() => {
            speakingRef.current = false;
            setSpokenAudioPlaying(false);
            nextPlayTimeRef.current = 0;
          }, remainingMs + 150);
        } else if (msg.type === "VOICE_SESSION_STARTED") {
          console.log(`Voice session started. STT mode: ${msg.stt_mode}`);
        } else if (msg.type === "STT_NO_SPEECH") {
          setSttMessage(msg.message || "Koi awaaz nahi mili.");
        } else if (msg.type === "STT_ERROR") {
          setSttMessage(msg.message || "Speech recognition failed.");
        }
      } catch (e) {
        console.error("Error parsing WS message:", e);
      }
    };

    ws.onclose = () => {
      if (unmounted) return;
      setIsConnected(false);
      console.log("WebSocket disconnected.");
    };

    ws.onerror = () => {
      // Browsers fire onerror on normal unmounts; no need to throw warnings
    };

    return () => {
      unmounted = true;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      recordingActiveRef.current = false;
      if (recorderRef.current) {
        void recorderRef.current.stop();
        recorderRef.current = null;
      }
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
    };
  }, [initPlaybackContext, playAudioChunk, markHighlight]);

  // Toggle Microphone recording
  const toggleRecording = async () => {
    initPlaybackContext();

    if (isRecording) {
      recordingActiveRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onend = null;
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.stop();
        } catch {
          // Ignore stop races.
        }
        recognitionRef.current = null;
      }

      // Flush the worklet tail BEFORE telling the backend to transcribe.
      if (recorderRef.current) {
        try {
          await recorderRef.current.stop();
        } catch (e) {
          console.error("Recorder stop error:", e);
        }
        recorderRef.current = null;
      }
      setIsRecording(false);

      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "STOP_VOICE_SESSION",
            // If the browser already sent the final transcript, don't let the
            // server re-transcribe the same audio (causes duplicate entries).
            skip_stt: clientTranscriptCountRef.current > 0,
          })
        );
      }
    } else {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        alert("KhataFlow engine se connection nahi hai. Kripya thoda intezaar karke dobara koshish karein.");
        return;
      }
      try {
        const recorder = new PCMAudioRecorder();
        recorderRef.current = recorder;
        clientTranscriptCountRef.current = 0;
        recordingActiveRef.current = true;

        // Notify backend to begin voice session (STT connection + status)
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: "START_VOICE_SESSION" }));
        }

        await recorder.start(
          (pcmChunk: ArrayBuffer) => {
            // Do not stream the assistant's own audio back into the recognizer.
            if (speakingRef.current) return;
            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              socketRef.current.send(pcmChunk);
            }
          },
          (waveform: Uint8Array) => {
            setWaveformData(new Uint8Array(waveform));
          }
        );

        setIsRecording(true);

        // Optional browser STT for instant interim/final text. If Google's
        // endpoint is blocked (the common "network" error), fall back to the
        // server-side AudioWorklet PCM recognizer and stop retrying.
        const speechWindow = window as SpeechWindow;
        const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
        if (SpeechRecognition && !browserSttFailedRef.current) {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = "hi-IN";

          recognition.onresult = (event: SpeechRecognitionEventLike) => {
            if (!recordingActiveRef.current || browserSttFailedRef.current) return;

            let interim = "";
            let latestFinal = "";
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              const item = event.results[i];
              if (item.isFinal) {
                latestFinal += item[0].transcript;
              } else {
                interim += item[0].transcript;
              }
            }

            if (latestFinal) {
              const cleaned = latestFinal.trim();
              if (!cleaned) return;
              const now = Date.now();
              if (
                cleaned === lastFinalRef.current.text &&
                now - lastFinalRef.current.at < 3000
              ) {
                return;
              }
              lastFinalRef.current = { text: cleaned, at: now };
              clientTranscriptCountRef.current += 1;

              setTranscript(cleaned);
              setIsFinalTranscript(true);
              setSttSource("browser");
              console.log("[STT Heard Final]:", cleaned);
              if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                socketRef.current.send(
                  JSON.stringify({
                    type: "PROCESS_TRANSCRIPT",
                    text: cleaned,
                    source: "browser",
                  })
                );
              }
            } else if (interim) {
              setTranscript(interim);
              setIsFinalTranscript(false);
              if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                socketRef.current.send(
                  JSON.stringify({ type: "INTERIM_TRANSCRIPT", text: interim })
                );
              }
            }
          };

          recognition.onerror = (e: SpeechRecognitionErrorLike) => {
            if (e.error === "network") {
              if (!browserSttFailedRef.current) {
                console.warn(
                  "[STT] Browser speech recognition unavailable (network). Using server-side PCM STT."
                );
              }
              browserSttFailedRef.current = true;
              setSttSource("server");
            } else if (e.error === "not-allowed" || e.error === "service-not-allowed") {
              console.warn("[STT] Browser speech recognition permission denied.");
              browserSttFailedRef.current = true;
            } else if (e.error !== "no-speech" && e.error !== "aborted") {
              console.warn("SpeechRecognition notice:", e.error);
            }
          };

          recognition.onend = () => {
            // Restart only while actively recording and while the browser
            // recognizer is still healthy (prevents an infinite network loop).
            if (recordingActiveRef.current && !browserSttFailedRef.current) {
              try {
                recognition.start();
              } catch {
                // Already started / cannot restart.
              }
            }
          };

          try {
            recognition.start();
            recognitionRef.current = recognition;
          } catch (e) {
            console.log("Recognition auto-start notice:", e);
          }
        }
      } catch (err) {
        recordingActiveRef.current = false;
        console.error("Error accessing microphone:", err);
        alert("Microphone access is required for real-time Indic voice transactions.");
      }
    }
  };

  // Trigger test speech simulation for demonstrations
  const handleSimulateSpeech = (text: string) => {
    initPlaybackContext();
    if (recordingActiveRef.current) {
      // Prevent a later STOP from re-transcribing the same utterance.
      clientTranscriptCountRef.current += 1;
    }
    setTranscript(text);
    setIsFinalTranscript(true);
    setSttSource("demo");
    setSttMessage(null);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "PROCESS_TRANSCRIPT",
          text: text,
          source: "demo",
        })
      );
    } else {
      // Fallback via HTTP REST API if WebSocket is currently transitioning
      fetch("http://localhost:8000/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ADD_CREDIT",
          customer: "Ramesh",
          amount: 350,
          notes: text,
        }),
      }).catch((e) => console.error("HTTP action error:", e));
    }
  };

  // Total Receivable calculation
  const totalReceivable = customers
    .filter((c) => c.total_balance > 0)
    .reduce((sum, c) => sum + c.total_balance, 0);

  const handleConfirmAction = (actionItem: { action?: string; customer?: string; amount?: number; notes?: string }) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "CONFIRM_ACTION",
          action: actionItem.action,
          customer: actionItem.customer,
          amount: actionItem.amount,
          notes: actionItem.notes,
        })
      );
    }
  };

  return (
    <div className="relative flex flex-col h-screen w-full bg-[#05070D] font-sans select-none overflow-hidden text-white">
      {/* Ambient Mesh Gradients */}
      <div className="absolute top-[-15%] left-[-10%] w-[550px] h-[550px] rounded-full bg-[#064E3B]/15 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-15%] right-[-10%] w-[550px] h-[550px] rounded-full bg-[#1E1B4B]/15 blur-[130px] pointer-events-none" />
      <div className="absolute top-[40%] right-[30%] w-[350px] h-[350px] rounded-full bg-emerald-500/[0.03] blur-[100px] pointer-events-none" />

      {/* Top Floating Glass Command Bar */}
      <header className="z-20 h-16 px-6 mx-4 mt-3 rounded-2xl glass-panel flex items-center justify-between shrink-0">
        {/* Left: Brand & Engine Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center font-bold text-slate-950 text-sm shadow-[0_0_15px_rgba(52,211,153,0.3)]">
              KF
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight text-white">KhataFlow</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.06] text-white/50 border border-white/[0.08]">
                  v2.0 POS
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      isConnected ? "bg-emerald-400" : "bg-rose-400"
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      isConnected ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                  />
                </span>
                <span className="text-[11px] text-white/50 font-medium">
                  {isConnected ? "Engine Online • 8000" : "Connecting..."}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Hero Animated Voice Trigger Button */}
        <div className="flex items-center">
          <button
            onClick={toggleRecording}
            className={`relative group px-6 py-2.5 rounded-full font-bold text-xs tracking-wide flex items-center gap-2.5 transition-all shadow-xl active:scale-[0.97] ${
              isRecording
                ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/50"
                : "bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400 text-slate-950 shadow-[0_0_25px_rgba(52,211,153,0.35)]"
            }`}
          >
            {/* Outer reactive pulse ring */}
            <span
              className={`absolute -inset-1 rounded-full opacity-40 blur-sm pointer-events-none transition-all ${
                isRecording
                  ? "bg-rose-500 animate-ping"
                  : "bg-emerald-400 group-hover:opacity-75"
              }`}
            />
            {isRecording ? (
              <>
                <MicOff className="h-4 w-4 relative z-10" />
                <span className="relative z-10 font-sans">Sun Raha Hoon (Tap to Stop)</span>
              </>
            ) : (
              <>
                <Mic className="h-4 w-4 relative z-10" />
                <span className="relative z-10 font-sans">Bol Kar Khata Likhein</span>
              </>
            )}
          </button>
        </div>

        {/* Right: Kul Udhaar KPI Pill Badge */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-[11px] font-medium text-white/50">Kul Udhaar:</span>
            <span className="font-mono font-bold text-sm text-[#FB7185] tabular-nums">
              ₹{totalReceivable.toLocaleString("en-IN")}
            </span>
          </div>

          <div className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono text-emerald-300 font-medium">
            Indic ASR
          </div>
        </div>
      </header>

      {/* Main Split Screen Area (42% Left Ledger | 58% Right Live Stage) */}
      <div className="flex flex-1 overflow-hidden pt-3 px-4 pb-4 gap-4">
        {/* Left Column: Kirana Ledger & Quick Feed (42% width) */}
        <div className="w-[42%] h-full overflow-hidden">
          <LedgerCards
            customers={customers}
            transactions={transactions}
            lastUpdatedCustomerId={lastUpdatedCustomerId}
          />
        </div>

        {/* Right Column: Live Voice & Smart Receipt Stage (58% width) */}
        <div className="w-[58%] h-full overflow-hidden">
          <LiveVisualizer
            isRecording={isRecording}
            transcript={transcript}
            isFinalTranscript={isFinalTranscript}
            extractedPayload={extractedPayload}
            ttfaLatencyMs={ttfaLatencyMs}
            waveformData={waveformData}
            spokenAudioPlaying={spokenAudioPlaying}
            onSimulateSpeech={handleSimulateSpeech}
            sttSource={sttSource}
            sttMessage={sttMessage}
            onConfirmAction={handleConfirmAction}
          />
        </div>
      </div>
    </div>
  );
}
