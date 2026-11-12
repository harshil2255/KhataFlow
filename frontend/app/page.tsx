"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { LedgerCards, Customer, Transaction } from "@/components/LedgerCards";
import { LiveVisualizer, ActionItem } from "@/components/LiveVisualizer";
import { PCMAudioRecorder } from "@/lib/audioRecorder";
import { PhoneCall, PhoneOff, Mic, Sparkles, Store, Flame, Zap } from "lucide-react";

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
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Live Call mode state
  const [isCallActive, setIsCallActive] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isFinalTranscript, setIsFinalTranscript] = useState(false);
  const [extractedPayload, setExtractedPayload] = useState<Record<string, unknown> | null>(null);
  const [ttfaLatencyMs, setTtfaLatencyMs] = useState<number | null>(null);
  const [spokenAudioPlaying, setSpokenAudioPlaying] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<PCMAudioRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const customersRef = useRef<Customer[]>([]);
  const callActiveRef = useRef(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sequential audio playback queue
  const nextPlayTimeRef = useRef(0);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initPlaybackContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    if (audioContextRef.current.state === "suspended") {
      void audioContextRef.current.resume();
    }
  }, []);

  // Decode audio chunks (MP3 / PCM from edge-tts)
  const playAudioChunk = useCallback(
    async (base64Data: string) => {
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

        // Decode audio data buffer
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const startAt = Math.max(ctx.currentTime + 0.02, nextPlayTimeRef.current);
        source.start(startAt);
        nextPlayTimeRef.current = startAt + audioBuffer.duration;

        setSpokenAudioPlaying(true);
      } catch (e) {
        // Fallback for raw PCM or incomplete chunk
      }
    },
    [initPlaybackContext]
  );

  const markHighlight = useCallback((customerId: number) => {
    setLastUpdatedCustomerId(customerId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setLastUpdatedCustomerId(null), 2500);
  }, []);

  // Setup WebSocket connection to FastAPI backend
  useEffect(() => {
    let unmounted = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connectWebSocket = () => {
      if (unmounted) return;
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000/ws";
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        if (unmounted) return;
        setIsConnected(true);
        console.log("KhataFlow Spatial WebSocket connected");
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
          } else if (msg.type === "TRANSCRIPT_STREAM") {
            setTranscript(msg.text || "");
            setIsFinalTranscript(!!msg.is_final);
          } else if (msg.type === "INTENT_EXTRACTED") {
            setExtractedPayload(msg.payload);
          } else if (msg.type === "LATENCY_METRIC") {
            setTtfaLatencyMs(msg.ttfa_ms);
          } else if (msg.type === "AUDIO_RESPONSE_CHUNK") {
            initPlaybackContext();
            void playAudioChunk(msg.audio_base64);
          } else if (msg.type === "AUDIO_RESPONSE_COMPLETE") {
            if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
            const ctx = audioContextRef.current;
            const remainingMs = ctx ? Math.max(0, (nextPlayTimeRef.current - ctx.currentTime) * 1000) : 0;
            drainTimerRef.current = setTimeout(() => {
              setSpokenAudioPlaying(false);
              nextPlayTimeRef.current = 0;
              // Full-Duplex phone call: if call is still active, listen for next turn!
              if (callActiveRef.current && recognitionRef.current) {
                try {
                  recognitionRef.current.start();
                } catch (e) {}
              }
            }, remainingMs + 200);
          }
        } catch (e) {
          console.error("Error parsing WS message:", e);
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setIsConnected(false);
        // Automatic reconnection every 2.5s if server restarts
        reconnectTimer = setTimeout(connectWebSocket, 2500);
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch (e) {}
      };
    };

    connectWebSocket();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socketRef.current) {
        if (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING) {
          socketRef.current.close();
        }
      }
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
    };
  }, [initPlaybackContext, playAudioChunk, markHighlight]);

  // Handle Full-Duplex Speech Recognition (VAD back-and-forth)
  const stopLiveCall = useCallback(() => {
    callActiveRef.current = false;
    setIsCallActive(false);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
      recognitionRef.current = null;
    }

    if (recorderRef.current) {
      void recorderRef.current.stop();
      recorderRef.current = null;
    }

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "STOP_RECORDING" }));
    }
  }, []);

  const startLiveCall = useCallback(async () => {
    initPlaybackContext();
    setIsCallActive(true);
    callActiveRef.current = true;
    setTranscript("");
    setIsFinalTranscript(false);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "START_RECORDING" }));
    }

    // Convert ArrayBuffer chunk to Base64 for WebSocket
    const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    };

    // 1. Start PCM audio recorder for streaming to server
    try {
      const rec = new PCMAudioRecorder();
      await rec.start(
        (chunkBuffer) => {
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            const base64Chunk = arrayBufferToBase64(chunkBuffer);
            socketRef.current.send(
              JSON.stringify({
                type: "AUDIO_CHUNK",
                chunk: base64Chunk,
              })
            );
          }
        },
        () => {}
      );
      recorderRef.current = rec;
      console.log("PCM mic stream started successfully");
    } catch (e) {
      console.warn("PCM Mic recorder failed, relying on WebSpeech:", e);
    }

    // 2. Initialize browser SpeechRecognition for instant local transcription
    const speechWin = window as unknown as SpeechWindow;
    const SpeechCtor = speechWin.SpeechRecognition || speechWin.webkitSpeechRecognition;

    if (SpeechCtor) {
      const recognition = new SpeechCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "hi-IN";

      recognition.onresult = (event) => {
        let interim = "";
        let finalStr = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalStr += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }

        const currentText = finalStr || interim;
        if (currentText) {
          setTranscript(currentText);
        }
        setIsFinalTranscript(!!finalStr);

        if (finalStr && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "PROCESS_TRANSCRIPT",
              text: finalStr,
              source: "webspeech",
            })
          );
        }
      };

      recognition.onerror = (err) => {
        console.warn("WebSpeech recognition error:", err);
      };

      recognition.onend = () => {
        if (callActiveRef.current && !spokenAudioPlaying) {
          try {
            recognition.start();
          } catch (e) {}
        }
      };

      try {
        recognition.start();
        recognitionRef.current = recognition;
      } catch (e) {
        console.error("SpeechRecognition start error:", e);
      }
    }
  }, [initPlaybackContext, spokenAudioPlaying]);

  const toggleLiveCall = useCallback(() => {
    if (isCallActive) {
      stopLiveCall();
    } else {
      void startLiveCall();
    }
  }, [isCallActive, startLiveCall, stopLiveCall]);

  const handleSimulateSpeech = (text: string) => {
    initPlaybackContext();
    setTranscript(text);
    setIsFinalTranscript(true);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "PROCESS_TRANSCRIPT",
          text: text,
          source: "demo",
        })
      );
    }
  };

  const handleConfirmAction = (actionItem: ActionItem) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "CONFIRM_ACTION",
          action: actionItem,
        })
      );
    }
  };

  const handleAddCustomer = async (data: { name: string; phone: string; opening_balance: number }) => {
    await fetch("http://localhost:8000/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  };

  const totalReceivable = customers
    .filter((c) => c.total_balance > 0)
    .reduce((sum, c) => sum + c.total_balance, 0);

  return (
    <div className="relative flex flex-col h-screen w-full bg-[#0A0C12] font-sans select-none overflow-hidden text-white">
      {/* Warm Ambient Radial Mesh Glows */}
      <div className="absolute top-[-10%] left-[-5%] w-[600px] h-[600px] rounded-full bg-[#1E1B4B]/25 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full bg-[#064E3B]/20 blur-[140px] pointer-events-none" />
      <div className="absolute top-[35%] right-[25%] w-[400px] h-[400px] rounded-full bg-emerald-500/[0.03] blur-[120px] pointer-events-none" />

      {/* Top Floating Glass Command Bar */}
      <header className="z-20 h-16 px-6 mx-4 mt-3 rounded-3xl glass-panel flex items-center justify-between shrink-0">
        {/* Left: Brand & Engine Status */}
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-2xl bg-gradient-to-tr from-emerald-400 via-teal-400 to-cyan-500 flex items-center justify-center font-bold text-slate-950 text-sm shadow-[0_0_20px_rgba(52,211,153,0.35)]">
            KF
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-white">KhataFlow</span>
              <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-white/[0.08] text-white/60 border border-white/[0.08]">
                Spatial POS
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
                {isConnected ? "Engine Online • edge-tts • Groq" : "Connecting..."}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Live Call Toggle Bar */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleLiveCall}
            className={`relative group px-6 py-2.5 rounded-full font-bold text-xs tracking-wide flex items-center gap-2.5 transition-all shadow-xl active:scale-[0.97] ${
              isCallActive
                ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/50"
                : "bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400 text-slate-950 shadow-[0_0_25px_rgba(52,211,153,0.35)]"
            }`}
          >
            {isCallActive ? (
              <>
                <PhoneOff className="h-4 w-4 relative z-10" />
                <span className="relative z-10 font-sans">End Live Call</span>
              </>
            ) : (
              <>
                <PhoneCall className="h-4 w-4 relative z-10" />
                <span className="relative z-10 font-sans">Start Live AI Call</span>
              </>
            )}
          </button>
        </div>

        {/* Right: Kul Udhaar KPI Pill Badge */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-4 py-1.5 rounded-2xl bg-white/[0.03] border border-white/[0.08]">
            <span className="text-[11px] font-medium text-white/50">Kul Udhaar:</span>
            <span className="font-mono font-bold text-sm text-[#FB7185] tabular-nums">
              ₹{totalReceivable.toLocaleString("en-IN")}
            </span>
          </div>

          <div className="px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono text-emerald-300 font-medium">
            Full-Duplex VAD
          </div>
        </div>
      </header>

      {/* Main Bento Split-Screen Area (42% Left Ledger | 58% Right Call & Smart Bill Stage) */}
      <div className="flex flex-1 overflow-hidden pt-3 px-4 pb-4 gap-4">
        {/* Left Column: Grahak Khata (42% width) */}
        <div className="w-[42%] h-full overflow-hidden">
          <LedgerCards
            customers={customers}
            transactions={transactions}
            lastUpdatedCustomerId={lastUpdatedCustomerId}
            onCustomerSelect={(cust) => setSelectedCustomer(cust)}
            selectedCustomerId={selectedCustomer?.id}
            onAddCustomer={handleAddCustomer}
          />
        </div>

        {/* Right Column: AI Call Stage & Smart Kirana Receipt (58% width) */}
        <div className="w-[58%] h-full overflow-hidden">
          <LiveVisualizer
            isCallActive={isCallActive}
            onToggleCall={toggleLiveCall}
            transcript={transcript}
            isFinalTranscript={isFinalTranscript}
            extractedPayload={extractedPayload}
            ttfaLatencyMs={ttfaLatencyMs}
            spokenAudioPlaying={spokenAudioPlaying}
            onSimulateSpeech={handleSimulateSpeech}
            onConfirmAction={handleConfirmAction}
            selectedCustomer={selectedCustomer}
            onClearSelectedCustomer={() => setSelectedCustomer(null)}
          />
        </div>
      </div>
    </div>
  );
}
