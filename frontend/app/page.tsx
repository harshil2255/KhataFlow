"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { LedgerCards, Customer, Transaction } from "@/components/LedgerCards";
import { LiveVisualizer, ActionItem } from "@/components/LiveVisualizer";
import { BillsTab } from "@/components/BillsTab";
import { AnalyticsTab } from "@/components/AnalyticsTab";
import { SettingsTab } from "@/components/SettingsTab";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { PCMAudioRecorder } from "@/lib/audioRecorder";
import {
  Users,
  FileText,
  BarChart3,
  Settings,
  Mic,
  MicOff,
  Sparkles,
  Wallet,
  Activity,
  Layers,
  Palette,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type ActiveTab = "customers" | "bills" | "analytics" | "settings";

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

function KhataFlowDashboard() {
  const { theme, accentColors } = useTheme();
  const [activeTab, setActiveTab] = useState<ActiveTab>("customers");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [lastUpdatedCustomerId, setLastUpdatedCustomerId] = useState<number | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Standard Voice Input state
  const [isRecording, setIsRecording] = useState(false);
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
  const recordingActiveRef = useRef(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Audio playback queue
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

        const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        const startAt = Math.max(ctx.currentTime + 0.02, nextPlayTimeRef.current);
        source.start(startAt);
        nextPlayTimeRef.current = startAt + audioBuffer.duration;

        setSpokenAudioPlaying(true);
      } catch (e) {}
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
            setSelectedCustomer(null);
          } else if (msg.type === "LATENCY_METRIC") {
            setTtfaLatencyMs(msg.ttfa_ms);
          } else if (msg.type === "AUDIO_RESPONSE_CHUNK") {
            initPlaybackContext();
            void playAudioChunk(msg.audio_base64);
          } else if (msg.type === "AUDIO_RESPONSE_COMPLETE") {
            if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
            drainTimerRef.current = setTimeout(() => {
              setSpokenAudioPlaying(false);
            }, 300);
          }
        } catch (e) {}
      };

      ws.onclose = () => {
        if (unmounted) return;
        setIsConnected(false);
        reconnectTimer = setTimeout(connectWebSocket, 1500);
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
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onclose = null;
        socketRef.current.onerror = null;
        try {
          socketRef.current.close();
        } catch (e) {}
      }
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (drainTimerRef.current) clearTimeout(drainTimerRef.current);
    };
  }, [initPlaybackContext, playAudioChunk, markHighlight]);

  // Push-to-Talk Voice Recording
  const stopRecording = useCallback(() => {
    recordingActiveRef.current = false;
    setIsRecording(false);

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

  const startRecording = useCallback(async () => {
    initPlaybackContext();
    setIsRecording(true);
    recordingActiveRef.current = true;
    setTranscript("");
    setIsFinalTranscript(false);

    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "START_RECORDING" }));
    }

    const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return window.btoa(binary);
    };

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
    } catch (e) {}

    // WebSpeech instant local feedback
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

      recognition.onerror = () => {};
      recognition.onend = () => {
        if (recordingActiveRef.current) {
          try {
            recognition.start();
          } catch (e) {}
        }
      };

      try {
        recognition.start();
        recognitionRef.current = recognition;
      } catch (e) {}
    }
  }, [initPlaybackContext]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      void startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const handleSimulateSpeech = (text: string) => {
    setTranscript(text);
    setIsFinalTranscript(true);
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "PROCESS_TRANSCRIPT",
          text,
          source: "simulation",
        })
      );
    }
  };

  const handleConfirmAction = (action: ActionItem) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "CONFIRM_ACTION",
          action,
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

  const handleDeleteCustomer = async (customerId: number) => {
    await fetch(`http://localhost:8000/api/customers/${customerId}`, {
      method: "DELETE",
    });
  };

  const handleUpdateCustomer = async (customerId: number, data: { name: string; phone?: string }) => {
    await fetch(`http://localhost:8000/api/customers/${customerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  };

  const totalReceivable = customers
    .filter((c) => c.total_balance > 0)
    .reduce((sum, c) => sum + c.total_balance, 0);

  return (
    <div className="relative h-screen w-screen overflow-hidden flex flex-col bg-[#0A0C12] text-white font-sans select-none">
      {/* Dynamic Background Layer (Fixed z-0) */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        {theme.bgType === "image" && theme.bgUrl ? (
          <img
            src={theme.bgUrl}
            alt="Custom Spatial Wallpaper"
            className="w-full h-full object-cover object-center"
          />
        ) : theme.bgType === "video" && theme.bgUrl ? (
          <video
            src={theme.bgUrl}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover object-center"
          />
        ) : (
          /* Ambient Mesh Glow Orbs */
          <>
            <div
              className="absolute top-[-15%] left-[-10%] w-[700px] h-[700px] rounded-full blur-[160px] opacity-35"
              style={{ backgroundColor: accentColors.radialOrb1 }}
            />
            <div
              className="absolute bottom-[-15%] right-[-10%] w-[700px] h-[700px] rounded-full blur-[160px] opacity-30"
              style={{ backgroundColor: accentColors.radialOrb2 }}
            />
            <div
              className="absolute top-[30%] right-[30%] w-[500px] h-[500px] rounded-full blur-[140px] opacity-15"
              style={{ backgroundColor: accentColors.primary }}
            />
          </>
        )}

        {/* Global Dark Glass Tint Overlay so content is always high-contrast */}
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: `rgba(10, 12, 18, ${theme.tintOpacity})`,
          }}
        />
      </div>

      {/* Top Floating Glass Header (h-16) */}
      <header
        className="z-20 h-16 px-6 mx-4 mt-3 rounded-3xl flex items-center justify-between shrink-0"
        style={{
          backgroundColor: `rgba(17, 21, 34, ${theme.glassOpacity})`,
          backdropFilter: `blur(${theme.glassBlur}px)`,
          WebkitBackdropFilter: `blur(${theme.glassBlur}px)`,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08), 0 20px 50px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Left: Brand Mark */}
        <div className="flex items-center gap-3">
          <div
            className={`h-9 w-9 rounded-2xl bg-gradient-to-tr ${accentColors.gradient} flex items-center justify-center font-bold text-slate-950 text-sm shadow-[0_0_20px_rgba(52,211,153,0.35)]`}
          >
            KF
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm tracking-tight text-white">KhataFlow</span>
              <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-white/[0.08] text-white/60 border border-white/[0.08]">
                Dukaan ka Smart Saathi
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
                {isConnected ? "Voice AI Online • Groq • edge-tts" : "Connecting..."}
              </span>
            </div>
          </div>
        </div>

        {/* Center: Tactile Pill Trigger "Bol Kar Khata Likhein" with Mic & Wave */}
        <div className="flex items-center">
          <button
            onClick={toggleRecording}
            className={`relative group px-5 py-2 rounded-full font-bold text-xs tracking-wide flex items-center gap-3 transition-all shadow-xl active:scale-[0.97] border ${
              isRecording
                ? "bg-rose-600 hover:bg-rose-500 text-white border-rose-400/50 shadow-rose-900/50"
                : "bg-white/[0.06] hover:bg-white/[0.1] border-white/10 text-white shadow-lg"
            }`}
          >
            {/* Glowing circular mic button on the left */}
            <div
              className={`h-7 w-7 rounded-full flex items-center justify-center transition-all ${
                isRecording
                  ? "bg-white text-rose-600 animate-pulse"
                  : `bg-gradient-to-r ${accentColors.gradient} text-slate-950 shadow-[0_0_15px_rgba(52,211,153,0.4)]`
              }`}
            >
              {isRecording ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
            </div>

            <span className="font-sans font-semibold">
              {isRecording ? "Sun Raha Hoon (Tap to Stop)" : "Bol Kar Khata Likhein"}
            </span>

            {/* Live animated waveform on the right */}
            <div className="flex items-center gap-0.5 h-4 px-1">
              {[0.4, 0.8, 1.2, 0.6, 1.0].map((h, i) => (
                <motion.span
                  key={i}
                  animate={{
                    scaleY: isRecording ? [0.3, 1.4, 0.4] : [0.3, 0.7, 0.3],
                  }}
                  transition={{
                    repeat: Infinity,
                    duration: 0.8,
                    delay: i * 0.12,
                    ease: "easeInOut",
                  }}
                  className={`w-0.5 h-3 rounded-full ${
                    isRecording ? "bg-rose-400" : "bg-emerald-400"
                  }`}
                />
              ))}
            </div>
          </button>
        </div>

        {/* Right: Frosted Wallet KPI Pill & Theme Pill */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] shadow-inner">
            <Wallet className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-mono font-bold text-xs text-[#FB7185] tabular-nums">
              ₹{totalReceivable.toLocaleString("en-IN")}
            </span>
            <span className="text-[11px] text-white/50 font-medium">Total Receivable</span>
          </div>

          <button
            onClick={() => setActiveTab("settings")}
            className="h-9 w-9 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] flex items-center justify-center text-white/70 hover:text-white transition-colors"
            title="Appearance Studio"
          >
            <Palette className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Workspace Frame with Left Nav Rail */}
      <div className="flex flex-1 overflow-hidden pt-3 px-4 pb-4 gap-4 z-10">
        {/* Left Floating Navigation Rail (w-24) */}
        <nav
          className="w-24 h-full rounded-3xl p-3 flex flex-col justify-between items-center shrink-0"
          style={{
            backgroundColor: `rgba(17, 21, 34, ${theme.glassOpacity})`,
            backdropFilter: `blur(${theme.glassBlur}px)`,
            WebkitBackdropFilter: `blur(${theme.glassBlur}px)`,
            border: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08), 0 20px 50px rgba(0, 0, 0, 0.5)",
          }}
        >
          {/* Top: 4 Nav Buttons with Animated LayoutId Pill */}
          <div className="w-full flex flex-col items-center gap-2 pt-1">
            {(
              [
                { id: "customers", label: "Customers", icon: Users },
                { id: "bills", label: "Bills", icon: FileText },
                { id: "analytics", label: "Analytics", icon: BarChart3 },
                { id: "settings", label: "Settings", icon: Settings },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full py-2.5 px-1 rounded-2xl relative flex flex-col items-center gap-1 transition-all ${
                    isActive ? "text-white" : "text-white/45 hover:text-white/80"
                  }`}
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeNavRailPill"
                      className="absolute inset-0 bg-white/[0.1] border border-white/20 rounded-2xl shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                      transition={{ type: "spring", stiffness: 450, damping: 35 }}
                    />
                  )}
                  <Icon className={`h-5 w-5 relative z-10 ${isActive ? "text-emerald-400" : ""}`} />
                  <span className="text-[10px] font-semibold tracking-tight relative z-10">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Bottom Rail Badge: Powered by AI Voice Tech */}
          <div className="p-2 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex flex-col items-center text-center gap-1 w-full">
            <span className="text-[8px] font-mono uppercase tracking-wider text-white/40 leading-none">
              AI Voice
            </span>
            <div className="flex items-center gap-0.5 h-2">
              <span className="w-0.5 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="w-0.5 h-3 bg-cyan-400 rounded-full animate-pulse delay-75" />
              <span className="w-0.5 h-1.5 bg-indigo-400 rounded-full animate-pulse delay-150" />
            </div>
          </div>
        </nav>

        {/* Tab Content Stage */}
        <main className="flex-1 h-full overflow-hidden">
          <AnimatePresence mode="wait">
            {activeTab === "customers" && (
              <motion.div
                key="customers"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.15 }}
                className="h-full flex gap-4 overflow-hidden"
              >
                {/* Left Column (35% Width): Customer Directory Card */}
                <div className="w-[35%] h-full overflow-hidden">
                  <LedgerCards
                    customers={customers}
                    transactions={transactions}
                    lastUpdatedCustomerId={lastUpdatedCustomerId}
                    onCustomerSelect={(cust) => setSelectedCustomer(cust)}
                    selectedCustomerId={selectedCustomer?.id}
                    onAddCustomer={handleAddCustomer}
                    onDeleteCustomer={handleDeleteCustomer}
                    onUpdateCustomer={handleUpdateCustomer}
                  />
                </div>

                {/* Right Column (65% Width): Stacked AI Call Stage & Smart Receipt */}
                <div className="w-[65%] h-full overflow-hidden">
                  <LiveVisualizer
                    isRecording={isRecording}
                    onToggleRecording={toggleRecording}
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
              </motion.div>
            )}

            {activeTab === "bills" && (
              <motion.div
                key="bills"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.15 }}
                className="h-full w-full overflow-hidden"
              >
                <BillsTab
                  customers={customers}
                  transactions={transactions}
                  onSelectCustomerBill={(cust) => {
                    setSelectedCustomer(cust);
                    setActiveTab("customers");
                  }}
                />
              </motion.div>
            )}

            {activeTab === "analytics" && (
              <motion.div
                key="analytics"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.15 }}
                className="h-full w-full overflow-hidden"
              >
                <AnalyticsTab
                  customers={customers}
                  transactions={transactions}
                  onSelectCustomer={(cust) => {
                    setSelectedCustomer(cust);
                    setActiveTab("customers");
                  }}
                />
              </motion.div>
            )}

            {activeTab === "settings" && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.15 }}
                className="h-full w-full overflow-hidden"
              >
                <SettingsTab />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <ThemeProvider>
      <KhataFlowDashboard />
    </ThemeProvider>
  );
}
