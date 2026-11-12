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
  Edit3,
  Check,
  ChevronRight,
  Zap,
  Store,
} from "lucide-react";

interface ActionItem {
  action?: string;
  customer?: string;
  amount?: number;
  notes?: string;
  date?: string;
  target?: string;
  items?: Array<{ name: string; qty?: string; price?: number }>;
}

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
  onConfirmAction?: (action: ActionItem) => void;
}

interface ParsedLineItem {
  id: string;
  name: string;
  qty: string;
  rate: number;
  total: number;
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
  onConfirmAction,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [currentDateStr, setCurrentDateStr] = useState("Today");

  useEffect(() => {
    setCurrentDateStr(
      new Date().toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    );
  }, []);

  // Auto-reset confirmed status on new extracted payload
  useEffect(() => {
    setConfirmed(false);
  }, [extractedPayload]);

  // Extract structured action items from payload
  const actions: ActionItem[] = useMemo(() => {
    if (!extractedPayload || typeof extractedPayload !== "object") return [];
    const p = extractedPayload as Record<string, unknown>;
    if (Array.isArray(p.actions)) return p.actions as ActionItem[];
    if (p.action && typeof p.action === "string") {
      return [
        {
          action: p.action,
          customer: typeof p.customer === "string" ? p.customer : undefined,
          amount: typeof p.amount === "number" ? p.amount : undefined,
          notes: typeof p.notes === "string" ? p.notes : undefined,
          target: typeof p.target === "string" ? p.target : undefined,
        },
      ];
    }
    return [];
  }, [extractedPayload]);

  // Fallback default action item for smart receipt demonstration
  const primaryAction = useMemo(() => {
    if (actions.length > 0) return actions[0];
    if (transcript && transcript.length > 0) {
      return {
        action: "ADD_CREDIT",
        customer: "Pooja",
        amount: 250,
        notes: transcript,
      };
    }
    return {
      action: "ADD_CREDIT",
      customer: "Pooja",
      amount: 250,
      notes: "200 Maida + 50 Maggi",
    };
  }, [actions, transcript]);

  // Parse itemized lines from notes (e.g. "200 Maida + 50 Maggi" or "100 Chawal, 50 Cheeni")
  const lineItems: ParsedLineItem[] = useMemo(() => {
    const notesStr = primaryAction.notes || "";
    const items: ParsedLineItem[] = [];

    // Check if notes contain '+' or ',' or 'aur'
    const parts = notesStr.split(/[+,]|(?:\s+aur\s+)|(?:\s+and\s+)/i);

    parts.forEach((part, idx) => {
      const clean = part.trim();
      if (!clean) return;

      // Match amount like "200 Maida" or "Maida 200" or "200 ka maida"
      const matchNumFirst = clean.match(/(\d+)\s*(?:(?:rs|rupaye|rupees|ka|ki)\s*)?([a-zA-Z\u0900-\u097F\s]+)/i);
      const matchTextFirst = clean.match(/([a-zA-Z\u0900-\u097F\s]+)\s*(\d+)/i);

      if (matchNumFirst) {
        const rate = parseInt(matchNumFirst[1], 10);
        const name = matchNumFirst[2].replace(/kharidi|kharida|packet|kg|pack/gi, "").trim() || "Item " + (idx + 1);
        items.push({
          id: `item-${idx}`,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          qty: "1 pkt",
          rate,
          total: rate,
        });
      } else if (matchTextFirst) {
        const rate = parseInt(matchTextFirst[2], 10);
        const name = matchTextFirst[1].replace(/kharidi|kharida|packet|kg|pack/gi, "").trim() || "Item " + (idx + 1);
        items.push({
          id: `item-${idx}`,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          qty: "1 pkt",
          rate,
          total: rate,
        });
      }
    });

    if (items.length === 0) {
      // Default line item fallback
      const totalAmt = primaryAction.amount || 250;
      if (totalAmt === 250) {
        return [
          { id: "1", name: "Fresh Maida (Flour)", qty: "2 kg", rate: 100, total: 200 },
          { id: "2", name: "Maggi 2-Minute Noodles", qty: "2 pkts", rate: 25, total: 50 },
        ];
      }
      return [
        {
          id: "1",
          name: primaryAction.notes ? primaryAction.notes.slice(0, 24) : "General Kirana Items",
          qty: "1 lot",
          rate: totalAmt,
          total: totalAmt,
        },
      ];
    }

    return items;
  }, [primaryAction]);

  const grandTotal = useMemo(() => {
    if (lineItems.length > 0) {
      return lineItems.reduce((acc, curr) => acc + curr.total, 0);
    }
    return primaryAction.amount || 250;
  }, [lineItems, primaryAction]);

  // Organic liquid wave / multi-bar visualizer
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

      // Render 32 tactile equalizer vertical bars
      const barCount = 32;
      const spacing = 4;
      const totalSpacing = (barCount - 1) * spacing;
      const barWidth = Math.max(3, (width - 40 - totalSpacing) / barCount);
      const startX = (width - (barCount * barWidth + totalSpacing)) / 2;

      for (let i = 0; i < barCount; i++) {
        const x = startX + i * (barWidth + spacing);
        let barHeight = 6;

        if (isRecording && waveformData && waveformData.length > 0) {
          const sampleIndex = Math.floor((i / barCount) * waveformData.length);
          const raw = waveformData[sampleIndex] || 128;
          const amp = Math.abs(raw - 128) / 128;
          barHeight = Math.max(6, amp * (height * 0.75));
        } else if (isRecording) {
          // Soft rhythmic idle listening pulsation
          const sine = Math.sin(step * 0.08 + i * 0.35);
          barHeight = 10 + Math.abs(sine) * 28;
        } else if (spokenAudioPlaying) {
          // Playback pulsation
          const sine = Math.cos(step * 0.12 + i * 0.4);
          barHeight = 8 + Math.abs(sine) * 32;
        } else {
          // Static resting state
          barHeight = 5 + Math.sin(i * 0.2) * 2;
        }

        const y = (height - barHeight) / 2;

        // Gradient for each bar
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        if (isRecording) {
          gradient.addColorStop(0, "#34D399"); // Emerald 400
          gradient.addColorStop(1, "#059669"); // Emerald 600
        } else if (spokenAudioPlaying) {
          gradient.addColorStop(0, "#38BDF8"); // Sky 400
          gradient.addColorStop(1, "#2563EB"); // Blue 600
        } else {
          gradient.addColorStop(0, "rgba(255, 255, 255, 0.2)");
          gradient.addColorStop(1, "rgba(255, 255, 255, 0.05)");
        }

        ctx.fillStyle = gradient;
        // Rounded bar capsule
        ctx.beginPath();
        const radius = barWidth / 2;
        ctx.roundRect(x, y, barWidth, barHeight, [radius]);
        ctx.fill();
      }

      step++;
      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isRecording, waveformData, spokenAudioPlaying]);

  return (
    <div className="h-full flex flex-col p-4 md:p-6 overflow-y-auto space-y-5 select-none">
      {/* Top Card: Fluid Voice Visualizer & STT Live Feed */}
      <div className="glass-panel p-5 relative overflow-hidden flex flex-col gap-3 group">
        {/* Ambient Top Glow */}
        <div
          className={`absolute -top-14 left-1/2 -translate-x-1/2 w-80 h-28 blur-3xl rounded-full pointer-events-none transition-all duration-700 ${
            isRecording
              ? "bg-emerald-500/20"
              : spokenAudioPlaying
              ? "bg-sky-500/20"
              : "bg-emerald-500/5"
          }`}
        />

        <div className="flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            <div
              className={`h-7 w-7 rounded-xl flex items-center justify-center border transition-all ${
                isRecording
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)] animate-pulse"
                  : spokenAudioPlaying
                  ? "bg-sky-500/20 border-sky-500/40 text-sky-400"
                  : "bg-white/[0.04] border-white/[0.08] text-white/50"
              }`}
            >
              {spokenAudioPlaying ? (
                <Volume2 className="h-4 w-4 animate-bounce" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </div>
            <div>
              <div className="text-xs font-semibold tracking-wide text-white flex items-center gap-2">
                <span>INDIC VOICE STREAM</span>
                {isRecording && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                    LIVE REC
                  </span>
                )}
              </div>
              <p className="text-[11px] text-white/40">
                {sttSource
                  ? `Engine: ${sttSource.toUpperCase()} Indic ASR`
                  : "Gnani / WebSpeech Hindi-English Mixed Engine"}
              </p>
            </div>
          </div>

          {/* Latency Pill */}
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
        <div className="w-full h-16 relative flex items-center justify-center my-1">
          <canvas
            ref={canvasRef}
            width={600}
            height={64}
            className="w-full h-full block"
          />
        </div>

        {/* Live Transcription Bubble */}
        <div className="relative rounded-xl p-3.5 bg-black/40 border border-white/[0.06] shadow-inner">
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
                ? "FINAL FRAME"
                : transcript
                ? "STREAMING..."
                : "READY"}
            </span>
          </div>

          <p
            className={`text-sm leading-relaxed font-sans transition-all ${
              transcript ? "text-white/90 font-medium" : "text-white/30 italic"
            }`}
          >
            {transcript
              ? `“${transcript}”`
              : "Boliye jaise: 'Pooja ne 200 ka maida aur 50 ki Maggi li, udhaar likh do'..."}
          </p>

          {sttMessage && (
            <div className="mt-2 text-[11px] text-amber-400/90 font-mono bg-amber-500/10 px-2 py-1 rounded border border-amber-500/20">
              {sttMessage}
            </div>
          )}
        </div>
      </div>

      {/* Main Stage: Interactive Smart POS Receipt Card */}
      <div className="glass-panel p-6 relative overflow-hidden flex flex-col flex-1 shadow-2xl">
        {/* Subtle Watermark Receipt Icon */}
        <Receipt className="absolute -bottom-8 -right-8 h-40 w-40 text-white/[0.02] pointer-events-none rotate-12" />

        {/* Header of the POS Receipt */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.15)]">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  Smart Kirana Receipt
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" /> AI PARSED
                </span>
              </div>
              <p className="text-xs text-white/50">
                Auto-extracted items & balance ledger
              </p>
            </div>
          </div>

          {/* Action Badge */}
          <div className="text-right">
            <span
              className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg border ${
                primaryAction.action === "ADD_CREDIT"
                  ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                  : primaryAction.action === "SETTLE"
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                  : "bg-white/[0.05] border-white/10 text-white/70"
              }`}
            >
              {primaryAction.action === "ADD_CREDIT"
                ? "UDHAAR ENTRY"
                : primaryAction.action === "SETTLE"
                ? "JAMA / CHUKTA"
                : "LEDGER AUDIT"}
            </span>
          </div>
        </div>

        {/* Customer & Timestamp Info Strip */}
        <div className="grid grid-cols-2 gap-3 py-3.5 border-b border-white/[0.06] text-xs">
          <div>
            <span className="text-[10px] text-white/40 block font-mono uppercase tracking-wider mb-0.5">
              Customer Name
            </span>
            <span className="text-white font-semibold text-sm flex items-center gap-1.5">
              {primaryAction.customer || "Pooja"}
              <span className="text-[10px] text-emerald-400/80 font-mono font-normal">
                (Verified)
              </span>
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-white/40 block font-mono uppercase tracking-wider mb-0.5">
              Date & Invoice
            </span>
            <span className="text-white/80 font-mono text-xs">
              {currentDateStr} • #KF-8421
            </span>
          </div>
        </div>

        {/* Itemized Line Items Table */}
        <div className="flex-1 py-4 flex flex-col justify-start">
          <div className="grid grid-cols-12 text-[10px] font-mono uppercase tracking-wider text-white/40 pb-2 border-b border-white/[0.04]">
            <span className="col-span-6">Item Description</span>
            <span className="col-span-2 text-center">Qty</span>
            <span className="col-span-2 text-right">Rate</span>
            <span className="col-span-2 text-right">Total</span>
          </div>

          <div className="space-y-2.5 pt-2.5">
            <AnimatePresence>
              {lineItems.map((item, idx) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="grid grid-cols-12 items-center text-xs py-1 hover:bg-white/[0.02] rounded px-1 -mx-1 transition-colors"
                >
                  <div className="col-span-6 flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
                    <span className="text-white/90 font-medium truncate">
                      {item.name}
                    </span>
                  </div>
                  <span className="col-span-2 text-center text-white/60 font-mono text-[11px]">
                    {item.qty}
                  </span>
                  <span className="col-span-2 text-right text-white/60 font-mono tabular-nums text-[11px]">
                    ₹{item.rate}
                  </span>
                  <span className="col-span-2 text-right text-white font-mono font-semibold tabular-nums">
                    ₹{item.total}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Dotted Perforation Line */}
          <div className="my-5 border-b border-dashed border-white/15" />

          {/* Grand Totals & Calculation */}
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between text-white/50">
              <span>Subtotal</span>
              <span className="font-mono tabular-nums">₹{grandTotal}</span>
            </div>
            <div className="flex justify-between text-white/50">
              <span>GST / Tax (Kirana Exempt)</span>
              <span className="font-mono tabular-nums">₹0</span>
            </div>
            <div className="flex justify-between items-baseline pt-2 border-t border-white/[0.08]">
              <div>
                <span className="text-sm font-bold text-white tracking-wide block">
                  Grand Total (Kul Rashi)
                </span>
                <span className="text-[10px] text-white/40">
                  Added to Customer Outstanding Ledger
                </span>
              </div>
              <span className="text-2xl font-extrabold font-mono text-emerald-400 tabular-nums">
                ₹{grandTotal.toLocaleString("en-IN")}
              </span>
            </div>
          </div>
        </div>

        {/* Bottom Quick-Action Buttons */}
        <div className="pt-4 border-t border-white/[0.08] flex items-center gap-3">
          <button
            onClick={() => {
              setConfirmed(true);
              if (onConfirmAction) {
                onConfirmAction(primaryAction);
              }
            }}
            disabled={confirmed}
            className={`flex-1 py-3 px-4 rounded-xl font-bold text-xs tracking-wide flex items-center justify-center gap-2 transition-all shadow-lg ${
              confirmed
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-default"
                : "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-emerald-500/25 active:scale-[0.98]"
            }`}
          >
            {confirmed ? (
              <>
                <Check className="h-4 w-4" /> Khata Updated Successfully
              </>
            ) : (
              <>
                <FileCheck className="h-4 w-4" /> Confirm & Save to Khata
              </>
            )}
          </button>

          <button
            onClick={() => setConfirmed(false)}
            className="px-3.5 py-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/70 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all"
            title="Edit Transaction"
          >
            <Edit3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Edit</span>
          </button>

          <button
            onClick={() => {
              setConfirmed(false);
            }}
            className="px-3.5 py-3 rounded-xl bg-white/[0.04] hover:bg-rose-500/10 border border-white/[0.08] hover:border-rose-500/30 text-white/50 hover:text-rose-400 text-xs font-semibold flex items-center gap-1.5 transition-all"
            title="Discard Entry"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Discard</span>
          </button>
        </div>
      </div>

      {/* Quick Voice Simulation Glass Chips */}
      <div className="glass-panel p-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/50 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-amber-400" />
            Quick Voice Test Chips
          </span>
          <span className="text-[10px] text-white/40">
            One-click audio simulation
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            {
              label: "Pooja: ₹200 Maida + ₹50 Maggi",
              text: "पूजा ने 200 रुपये का मैदा खरीदा, 50 रुपये की Maggi खरीदी। उधार में डाल दो, तो total को calculate करके।",
              type: "udhaar",
            },
            {
              label: "Ramesh: ₹350 Jama / Chukta",
              text: "रमेश ने 350 रुपये नकद जमा कर दिए, खाता चुकता करो",
              type: "jama",
            },
            {
              label: "Mukesh: ₹500 Udhaar",
              text: "मुकेश भाई के खाते में 500 रुपये उधार लिख दो तेल और दाल का",
              type: "udhaar",
            },
            {
              label: "Pooja: Balance Enquiry",
              text: "पूजा का कितना बकाया बाकी है बताओ",
              type: "enquiry",
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
                    chip.type === "udhaar"
                      ? "bg-rose-400"
                      : chip.type === "jama"
                      ? "bg-emerald-400"
                      : "bg-sky-400"
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
