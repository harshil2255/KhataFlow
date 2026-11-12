"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Volume2,
  Clock,
  Sparkles,
  Receipt,
  FileCheck,
  RotateCcw,
  Check,
  ChevronRight,
  Zap,
  Store,
  X,
  Edit3,
} from "lucide-react";
import { Customer } from "./LedgerCards";

export interface LineItem {
  name: string;
  qty: number;
  unit?: string;
  unit_price: number;
  total: number;
}

export interface ActionItem {
  action?: string;
  customer?: string;
  amount?: number;
  notes?: string;
  date?: string;
  target?: string;
  items?: LineItem[];
}

interface LiveVisualizerProps {
  isRecording: boolean;
  onToggleRecording: () => void;
  transcript: string;
  isFinalTranscript: boolean;
  extractedPayload: unknown;
  ttfaLatencyMs: number | null;
  spokenAudioPlaying: boolean;
  onSimulateSpeech: (text: string) => void;
  onConfirmAction?: (action: ActionItem) => void;
  selectedCustomer: Customer | null;
  onClearSelectedCustomer: () => void;
}

export const LiveVisualizer: React.FC<LiveVisualizerProps> = ({
  isRecording,
  onToggleRecording,
  transcript,
  isFinalTranscript,
  extractedPayload,
  ttfaLatencyMs,
  spokenAudioPlaying,
  onSimulateSpeech,
  onConfirmAction,
  selectedCustomer,
  onClearSelectedCustomer,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [customerTxHistory, setCustomerTxHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    setConfirmed(false);
  }, [extractedPayload]);

  useEffect(() => {
    if (selectedCustomer) {
      setLoadingHistory(true);
      fetch(`http://localhost:8000/api/customers/${selectedCustomer.id}/transactions`)
        .then((res) => res.json())
        .then((data) => setCustomerTxHistory(data.transactions || []))
        .catch(() => setCustomerTxHistory([]))
        .finally(() => setLoadingHistory(false));
    } else {
      setCustomerTxHistory([]);
    }
  }, [selectedCustomer]);

  const payload = useMemo(() => {
    if (!extractedPayload || typeof extractedPayload !== "object") return null;
    return extractedPayload as Record<string, any>;
  }, [extractedPayload]);

  const primaryAction: ActionItem = useMemo(() => {
    if (payload?.actions && Array.isArray(payload.actions) && payload.actions.length > 0) {
      return payload.actions[0];
    }
    return {
      action: "ADD_CREDIT",
      customer: "Ramesh",
      amount: 430,
      notes: "430 Udhaar",
      items: [
        { name: "Kirana Rashan", qty: 1, unit: "lot", unit_price: 430, total: 430 }
      ]
    };
  }, [payload]);

  // Live itemized line items calculated as soon as you speak
  const lineItems: LineItem[] = useMemo(() => {
    if (primaryAction.items && primaryAction.items.length > 0) {
      return primaryAction.items;
    }

    const text = transcript || primaryAction.notes || "";
    if (text) {
      const items: LineItem[] = [];
      const matches = Array.from(
        text.matchAll(/(\d+)\s*(?:(?:rs|rupaye|rupees|ka|ki)\s*)?([a-zA-Z\u0900-\u097F\s]+)/gi)
      );

      for (const m of matches) {
        const price = parseFloat(m[1]);
        const rawName = m[2]
          .replace(/\b(kharidi|kharida|udhaar|likh|likho|aur|and|mein|me|dalo|do|to|total|bhai|rupaye|rs)\b/gi, "")
          .trim();
        if (rawName.length >= 2) {
          items.push({
            name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
            qty: 1,
            unit: "pkt",
            unit_price: price,
            total: price,
          });
        }
      }

      if (items.length > 0) return items;
    }

    const tot = primaryAction.amount || 430;
    return [
      { name: "Kirana Items", qty: 1, unit: "lot", unit_price: tot, total: tot }
    ];
  }, [primaryAction, transcript]);

  const grandTotal = useMemo(() => {
    if (lineItems.length > 0) {
      return lineItems.reduce((acc, curr) => acc + (curr.total || 0), 0);
    }
    return primaryAction.amount || 430;
  }, [lineItems, primaryAction]);

  // Multi-frequency Audio Equalizer Waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let step = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const barCount = 32;
      const spacing = 4;
      const totalSpacing = (barCount - 1) * spacing;
      const barWidth = Math.max(3, (width - 40 - totalSpacing) / barCount);
      const startX = (width - (barCount * barWidth + totalSpacing)) / 2;

      for (let i = 0; i < barCount; i++) {
        const x = startX + i * (barWidth + spacing);
        let barHeight = 6;

        if (isRecording) {
          const sine = Math.sin(step * 0.1 + i * 0.35);
          barHeight = 10 + Math.abs(sine) * 36;
        } else if (spokenAudioPlaying) {
          const sine = Math.cos(step * 0.15 + i * 0.4);
          barHeight = 8 + Math.abs(sine) * 34;
        } else {
          barHeight = 5 + Math.sin(i * 0.2) * 2;
        }

        const y = (height - barHeight) / 2;
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);

        if (isRecording) {
          gradient.addColorStop(0, "#34D399");
          gradient.addColorStop(1, "#059669");
        } else if (spokenAudioPlaying) {
          gradient.addColorStop(0, "#818CF8");
          gradient.addColorStop(1, "#4F46E5");
        } else {
          gradient.addColorStop(0, "rgba(255, 255, 255, 0.2)");
          gradient.addColorStop(1, "rgba(255, 255, 255, 0.05)");
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [barWidth / 2]);
        ctx.fill();
      }

      step++;
      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isRecording, spokenAudioPlaying]);

  return (
    <div className="h-full flex flex-col space-y-4 overflow-y-auto pr-1 select-none">
      {/* Top Card: Voice Waveform & Live STT Stream */}
      <div className="glass-panel p-5 relative overflow-hidden flex flex-col gap-3 group shrink-0">
        <div
          className={`absolute -top-14 left-1/2 -translate-x-1/2 w-80 h-28 blur-3xl rounded-full pointer-events-none transition-all duration-700 ${
            isRecording
              ? "bg-emerald-500/20"
              : spokenAudioPlaying
              ? "bg-indigo-500/20"
              : "bg-emerald-500/5"
          }`}
        />

        <div className="flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            <div
              className={`h-8 w-8 rounded-xl flex items-center justify-center border transition-all ${
                isRecording
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] animate-pulse"
                  : spokenAudioPlaying
                  ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-400 animate-pulse"
                  : "bg-white/[0.04] border-white/[0.08] text-white/50"
              }`}
            >
              {spokenAudioPlaying ? (
                <Volume2 className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </div>
            <div>
              <div className="text-xs font-semibold tracking-wide text-white flex items-center gap-2">
                <span>INDIC VOICE LEDGER ENGINE</span>
                {isRecording && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    LISTENING
                  </span>
                )}
                {spokenAudioPlaying && (
                  <span className="flex items-center gap-1 text-[10px] text-indigo-400 font-mono font-medium px-1.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
                    SPEAKING REPLY
                  </span>
                )}
              </div>
              <p className="text-[11px] text-white/40">
                Natural Indic Voice Recognition • Real-time Spoken Correction
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {ttfaLatencyMs !== null && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] font-mono text-white/70">
                <Clock className="h-3 w-3 text-emerald-400" />
                <span>{ttfaLatencyMs} ms</span>
              </div>
            )}
            <div className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono text-emerald-300 font-medium">
              16kHz PCM
            </div>
          </div>
        </div>

        {/* Dynamic Multi-Bar Waveform Canvas */}
        <div className="w-full h-14 relative flex items-center justify-center my-0.5">
          <canvas
            ref={canvasRef}
            width={600}
            height={56}
            className="w-full h-full block"
          />
        </div>

        {/* Live Transcription Bubble */}
        <div className="relative rounded-2xl p-3.5 bg-black/40 border border-white/[0.06] shadow-inner">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">
              Live Speech Transcript
            </span>
            <span
              className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md ${
                isFinalTranscript
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : transcript
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse"
                  : "text-white/30"
              }`}
            >
              {isFinalTranscript
                ? "FINAL"
                : transcript
                ? "STREAMING..."
                : "READY"}
            </span>
          </div>

          <p
            className={`text-sm leading-relaxed font-sans transition-all ${
              transcript ? "text-white/95 font-medium" : "text-white/30 italic"
            }`}
          >
            {transcript
              ? `“${transcript}”`
              : "Tap 'Bol Kar Khata Likhein' above or speak: 'Ramesh ka 340 udhaar' or 'Nahi, 430'..."}
          </p>
        </div>
      </div>

      {/* Main Stage: Itemized Smart Kirana Receipt Card */}
      <div className="glass-panel p-5 relative overflow-hidden flex flex-col shadow-2xl shrink-0">
        <Receipt className="absolute -bottom-6 -right-6 h-36 w-36 text-white/[0.02] pointer-events-none rotate-12" />

        {/* Receipt Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.15)]">
              <Store className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {selectedCustomer ? `${selectedCustomer.name} - Ledger History` : "Live Itemized Kirana Receipt"}
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" /> AI PARSED
                </span>
              </div>
              <p className="text-[11px] text-white/50">
                {selectedCustomer
                  ? "Customer transaction history ledger"
                  : "Automatic bill calculation & correction engine"}
              </p>
            </div>
          </div>

          {selectedCustomer ? (
            <button
              onClick={onClearSelectedCustomer}
              className="px-2.5 py-1 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white/60 text-xs flex items-center gap-1 transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Close History
            </button>
          ) : (
            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg border ${
                primaryAction.action === "ADD_CREDIT"
                  ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                  : primaryAction.action === "CORRECTION"
                  ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
                  : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
              }`}
            >
              {primaryAction.action === "ADD_CREDIT"
                ? "UDHAAR ENTRY"
                : primaryAction.action === "CORRECTION"
                ? "SUDHARA / CORRECTION"
                : "JAMA / CHUKTA"}
            </span>
          )}
        </div>

        {/* Customer & Timestamp Info Strip */}
        <div className="grid grid-cols-2 gap-3 py-2.5 border-b border-white/[0.06] text-xs shrink-0">
          <div>
            <span className="text-[10px] text-white/40 block font-mono uppercase tracking-wider mb-0.5">
              Customer Profile
            </span>
            <span className="text-white font-semibold text-xs flex items-center gap-1.5">
              {selectedCustomer ? selectedCustomer.name : primaryAction.customer || "Ramesh"}
              <span className="text-[10px] text-emerald-400 font-mono font-normal">
                (Verified)
              </span>
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-white/40 block font-mono uppercase tracking-wider mb-0.5">
              Invoice Reference
            </span>
            <span className="text-white/80 font-mono text-xs">
              #KF-
              {selectedCustomer ? selectedCustomer.id : "8421"}
            </span>
          </div>
        </div>

        {/* If user selected a customer on the left, display their transaction ledger */}
        {selectedCustomer ? (
          <div className="py-3 overflow-y-auto max-h-56 space-y-2 pr-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block mb-1">
              Past Purchases & Payments
            </span>
            {loadingHistory ? (
              <p className="text-xs text-white/40 py-4 text-center">Loading transactions...</p>
            ) : customerTxHistory.length === 0 ? (
              <p className="text-xs text-white/40 py-4 text-center">No past transactions found.</p>
            ) : (
              customerTxHistory.map((tx) => (
                <div
                  key={tx.id}
                  className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="text-white/90 font-medium block">{tx.notes || "Kirana Samaan"}</span>
                    <span className="text-[10px] text-white/40 font-mono">{tx.created_at}</span>
                  </div>
                  <span
                    className={`font-mono font-bold tabular-nums text-sm ${
                      tx.type === "CREDIT" ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {tx.type === "CREDIT" ? "+" : "-"}₹{tx.amount}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : (
          /* Itemized Line Items Table */
          <div className="py-2.5 flex flex-col justify-start">
            <div className="grid grid-cols-12 text-[10px] font-mono uppercase tracking-wider text-white/40 pb-1.5 border-b border-white/[0.04] shrink-0">
              <span className="col-span-5">Item</span>
              <span className="col-span-2 text-center">Qty</span>
              <span className="col-span-2 text-right">Rate (₹)</span>
              <span className="col-span-3 text-right">Total (₹)</span>
            </div>

            <div className="space-y-1.5 pt-1.5 overflow-y-auto max-h-40 pr-1">
              <AnimatePresence>
                {lineItems.map((item, idx) => (
                  <motion.div
                    key={`${item.name}-${idx}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="grid grid-cols-12 items-center text-xs py-1 hover:bg-white/[0.02] rounded px-1 -mx-1 transition-colors"
                  >
                    <div className="col-span-5 flex items-center gap-1.5 truncate">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80 shrink-0" />
                      <span className="text-white/90 font-medium truncate">{item.name}</span>
                    </div>
                    <span className="col-span-2 text-center text-white/60 font-mono text-[11px]">
                      {item.qty} {item.unit || "pkt"}
                    </span>
                    <span className="col-span-2 text-right text-white/60 font-mono tabular-nums text-[11px]">
                      ₹{item.unit_price}
                    </span>
                    <span className="col-span-3 text-right text-white font-mono font-semibold tabular-nums">
                      ₹{item.total}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="my-2.5 border-b border-dashed border-white/15 shrink-0" />

            <div className="space-y-1 text-xs shrink-0">
              <div className="flex justify-between items-baseline pt-0.5">
                <div>
                  <span className="text-xs font-bold text-white tracking-wide block">
                    Grand Total (Kul Rashi)
                  </span>
                  <span className="text-[10px] text-white/40">
                    Added to Customer Ledger Balance
                  </span>
                </div>
                <span className="text-2xl font-extrabold font-mono text-emerald-400 tabular-nums">
                  ₹{grandTotal.toLocaleString("en-IN")}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {!selectedCustomer && (
          <div className="pt-3 border-t border-white/[0.08] flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                setConfirmed(true);
                if (onConfirmAction) onConfirmAction(primaryAction);
              }}
              disabled={confirmed}
              className={`flex-1 py-2.5 px-4 rounded-2xl font-bold text-xs tracking-wide flex items-center justify-center gap-2 transition-all shadow-lg ${
                confirmed
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-default"
                  : "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-emerald-500/25 active:scale-95"
              }`}
            >
              {confirmed ? (
                <>
                  <Check className="h-4 w-4" /> Khata Updated Successfully
                </>
              ) : (
                <>
                  <FileCheck className="h-4 w-4" /> Save to Khata
                </>
              )}
            </button>

            <button
              onClick={() => setConfirmed(false)}
              className="px-4 py-2.5 rounded-2xl bg-white/[0.04] hover:bg-rose-500/10 border border-white/[0.08] hover:border-rose-500/30 text-white/50 hover:text-rose-400 text-xs font-semibold flex items-center gap-1.5 transition-all"
              title="Clear Entry"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>
          </div>
        )}
      </div>

      {/* Quick Voice Simulation Glass Chips */}
      <div className="glass-panel p-4 flex flex-col gap-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/50 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            Quick Indic Voice Scenarios
          </span>
          <span className="text-[10px] text-white/40">One-click testing</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            {
              label: "Spoken Correction: 'Nahi, 430 tha'",
              text: "नहीं 340 नहीं, 430 था",
              type: "correction",
            },
            {
              label: "Two Ramesh: Disambiguation Trigger",
              text: "रमेश का 350 उधार लिख दो",
              type: "disambiguation",
            },
            {
              label: "Resolve Disambiguation: 'Gupta ji'",
              text: "रमेश गुप्ता जी",
              type: "resolve",
            },
            {
              label: "Itemized: 200 Maida + 50 Maggi",
              text: "पूजा ने 200 रुपये का मैदा खरीदा, 50 रुपये की Maggi खरीदी। उधार में डाल दो, तो total को calculate करके।",
              type: "udhaar",
            },
          ].map((chip, i) => (
            <button
              key={i}
              onClick={() => onSimulateSpeech(chip.text)}
              className="text-left p-2.5 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/20 transition-all flex items-center justify-between group active:scale-[0.98]"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${
                    chip.type === "correction"
                      ? "bg-amber-400"
                      : chip.type === "disambiguation"
                      ? "bg-sky-400"
                      : chip.type === "resolve"
                      ? "bg-indigo-400"
                      : "bg-rose-400"
                  }`}
                />
                <span className="text-xs text-white/80 group-hover:text-white font-medium truncate">
                  {chip.label}
                </span>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-white/30 group-hover:text-white/80 group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
