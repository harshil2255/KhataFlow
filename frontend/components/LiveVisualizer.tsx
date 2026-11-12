"use client";

import React, { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PhoneCall,
  PhoneOff,
  Sparkles,
  Receipt,
  FileCheck,
  RotateCcw,
  Check,
  Zap,
  Store,
  Bot,
  User,
  ShoppingBag,
  History,
  X,
  ChevronRight,
} from "lucide-react";
import { Customer } from "./LedgerCards";

export type AIOrbState = "idle" | "listening" | "thinking" | "speaking" | "clarifying";

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

export interface IntentPayload {
  status?: string;
  actions?: ActionItem[];
  spoken_reply?: string;
  missing_fields?: string[];
  confidence?: number;
}

interface LiveVisualizerProps {
  isCallActive: boolean;
  onToggleCall: () => void;
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
  isCallActive,
  onToggleCall,
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
  const [confirmed, setConfirmed] = useState(false);
  const [customerTxHistory, setCustomerTxHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Auto-reset confirmed status on new extracted payload
  useEffect(() => {
    setConfirmed(false);
  }, [extractedPayload]);

  // Fetch transaction history when a customer card on the left is selected
  useEffect(() => {
    if (selectedCustomer) {
      setLoadingHistory(true);
      fetch(`http://localhost:8000/api/customers/${selectedCustomer.id}/transactions`)
        .then((res) => res.json())
        .then((data) => {
          setCustomerTxHistory(data.transactions || []);
        })
        .catch(() => setCustomerTxHistory([]))
        .finally(() => setLoadingHistory(false));
    } else {
      setCustomerTxHistory([]);
    }
  }, [selectedCustomer]);

  // Parse structured payload
  const payload: IntentPayload | null = useMemo(() => {
    if (!extractedPayload || typeof extractedPayload !== "object") return null;
    return extractedPayload as IntentPayload;
  }, [extractedPayload]);

  // Determine current AI Orb state
  const orbState: AIOrbState = useMemo(() => {
    if (spokenAudioPlaying) return "speaking";
    if (payload?.status === "NEEDS_CLARIFICATION") return "clarifying";
    if (isCallActive && transcript && !isFinalTranscript) return "listening";
    if (isCallActive && isFinalTranscript && !payload) return "thinking";
    if (isCallActive) return "listening";
    return "idle";
  }, [spokenAudioPlaying, payload, isCallActive, transcript, isFinalTranscript]);

  // Primary action extracted or default
  const primaryAction: ActionItem = useMemo(() => {
    if (payload?.actions && payload.actions.length > 0) {
      return payload.actions[0];
    }
    return {
      action: "ADD_CREDIT",
      customer: "Pooja",
      amount: 250,
      notes: "200 Maida + 50 Maggi",
      items: [
        { name: "Maida (Flour)", qty: 1, unit: "pkt", unit_price: 200, total: 200 },
        { name: "Maggi 2-Minute Noodles", qty: 1, unit: "pkt", unit_price: 50, total: 50 },
      ],
    };
  }, [payload]);

  // Fallback / real-time line items parsed directly from speech if LLM is streaming
  const lineItems: LineItem[] = useMemo(() => {
    // 1. If LLM extracted structured items, use them
    if (primaryAction.items && primaryAction.items.length > 0) {
      return primaryAction.items;
    }

    // 2. Real-time client-side live extraction as soon as the user speaks!
    const activeText = transcript || primaryAction.notes || "";
    if (activeText) {
      const items: LineItem[] = [];
      const matches = Array.from(
        activeText.matchAll(/(\d+)\s*(?:(?:rs|rupaye|rupees|ka|ki)\s*)?([a-zA-Z\u0900-\u097F\s]+)/gi)
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

      if (items.length > 0) {
        return items;
      }
    }

    // Default placeholder bill line items
    return [
      { name: "Maida (Flour)", qty: 1, unit: "pkt", unit_price: 200, total: 200 },
      { name: "Maggi 2-Minute Noodles", qty: 1, unit: "pkt", unit_price: 50, total: 50 },
    ];
  }, [primaryAction, transcript]);

  const grandTotal = useMemo(() => {
    if (lineItems.length > 0) {
      return lineItems.reduce((acc, curr) => acc + (curr.total || 0), 0);
    }
    return primaryAction.amount || 250;
  }, [lineItems, primaryAction]);

  // Dynamic visual styling for the living AI Plasma Orb based on 5 states
  const getOrbGradient = (state: AIOrbState) => {
    switch (state) {
      case "listening":
        return "from-emerald-400 via-teal-500 to-cyan-500 shadow-[0_0_50px_rgba(52,211,153,0.5)]";
      case "thinking":
        return "from-indigo-400 via-violet-500 to-purple-600 shadow-[0_0_50px_rgba(168,85,247,0.5)] animate-spin";
      case "speaking":
        return "from-violet-400 via-fuchsia-500 to-indigo-500 shadow-[0_0_50px_rgba(217,70,239,0.5)]";
      case "clarifying":
        return "from-amber-400 via-rose-500 to-orange-500 shadow-[0_0_50px_rgba(244,63,94,0.5)]";
      case "idle":
      default:
        return "from-slate-700 via-slate-800 to-slate-900 border border-white/10 shadow-[0_0_20px_rgba(255,255,255,0.05)]";
    }
  };

  const getOrbLabel = (state: AIOrbState) => {
    switch (state) {
      case "listening":
        return "Listening to Store Speech...";
      case "thinking":
        return "Thinking & Calculating Bill...";
      case "speaking":
        return "Assistant Answering...";
      case "clarifying":
        return "Asking for Clarification";
      case "idle":
      default:
        return "Spatial Voice Stage Ready";
    }
  };

  return (
    <div className="h-full flex flex-col space-y-4 overflow-y-auto pr-1 select-none">
      {/* Top Half: Living AI Call Companion ("Phone Call Mode") */}
      <div className="glass-panel p-5 relative overflow-hidden flex flex-col gap-4">
        {/* Ambient Glow Blob */}
        <div
          className={`absolute -top-16 left-1/2 -translate-x-1/2 w-96 h-36 blur-3xl rounded-full pointer-events-none transition-all duration-700 ${
            orbState === "listening"
              ? "bg-emerald-500/25"
              : orbState === "speaking"
              ? "bg-violet-500/25"
              : orbState === "clarifying"
              ? "bg-amber-500/25"
              : "bg-white/[0.03]"
          }`}
        />

        {/* Call Companion Header & Action */}
        <div className="flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/70">
              <Bot className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white tracking-wide">
                  SPATIAL AI CALL COMPANION
                </span>
                <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-medium">
                  Full-Duplex VAD
                </span>
              </div>
              <p className="text-[11px] text-white/40">{getOrbLabel(orbState)}</p>
            </div>
          </div>

          {/* Start Live Call / End Call Toggle */}
          <button
            onClick={onToggleCall}
            className={`px-4 py-2 rounded-2xl font-bold text-xs flex items-center gap-2 shadow-lg transition-all active:scale-95 ${
              isCallActive
                ? "bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 shadow-rose-950/40"
                : "bg-gradient-to-r from-emerald-400 to-teal-500 hover:from-emerald-300 hover:to-teal-400 text-slate-950 shadow-emerald-500/20"
            }`}
          >
            {isCallActive ? (
              <>
                <PhoneOff className="h-3.5 w-3.5" /> End Live Call
              </>
            ) : (
              <>
                <PhoneCall className="h-3.5 w-3.5" /> Start Live Call
              </>
            )}
          </button>
        </div>

        {/* Living AI Plasma Orb Stage */}
        <div className="flex items-center justify-center py-2 relative">
          <div className="relative flex items-center justify-center">
            {/* Outer pulsating wave ring when active */}
            {isCallActive && (
              <motion.div
                animate={{
                  scale: [1, 1.25, 1],
                  opacity: [0.3, 0.7, 0.3],
                }}
                transition={{
                  repeat: Infinity,
                  duration: orbState === "speaking" ? 1.2 : 2.5,
                  ease: "easeInOut",
                }}
                className={`absolute w-24 h-24 rounded-full pointer-events-none blur-md ${
                  orbState === "speaking"
                    ? "bg-violet-500"
                    : orbState === "clarifying"
                    ? "bg-amber-400"
                    : "bg-emerald-400"
                }`}
              />
            )}

            {/* Core Morphing Plasma Orb */}
            <motion.div
              animate={{
                scale:
                  orbState === "speaking"
                    ? [1, 1.08, 0.98, 1.05, 1]
                    : orbState === "listening"
                    ? [1, 1.04, 1]
                    : [1, 1.02, 1],
              }}
              transition={{
                repeat: Infinity,
                duration: 2.2,
                ease: "easeInOut",
              }}
              className={`w-16 h-16 rounded-full bg-gradient-to-tr ${getOrbGradient(
                orbState
              )} flex items-center justify-center cursor-pointer transition-colors duration-500 shadow-2xl relative z-10`}
            >
              <Sparkles className="h-6 w-6 text-white drop-shadow-md" />
            </motion.div>
          </div>
        </div>

        {/* Floating Dialogue Bubbles (User Speech + AI Spoken Reply) */}
        <div className="space-y-2 z-10">
          {/* Shopkeeper Speech Bubble */}
          <div className="p-3 rounded-2xl bg-black/40 border border-white/[0.06] flex items-start gap-2.5">
            <div className="h-5 w-5 rounded-lg bg-white/[0.08] flex items-center justify-center shrink-0 mt-0.5">
              <User className="h-3 w-3 text-white/60" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-white/40 uppercase">Shopkeeper</span>
                <span className="text-[10px] font-mono text-emerald-400/80">
                  {isFinalTranscript ? "Final Frame" : transcript ? "Streaming..." : "Standby"}
                </span>
              </div>
              <p className="text-xs text-white/90 font-medium mt-0.5 leading-relaxed">
                {transcript
                  ? `“${transcript}”`
                  : isCallActive
                  ? "Boliye jaise: 'Pooja ne 200 ka maida aur 50 ki Maggi li, udhaar likh do'..."
                  : "Tap 'Start Live Call' or click test chips below to speak"}
              </p>
            </div>
          </div>

          {/* AI Live Spoken Reply Bubble */}
          {(payload?.spoken_reply || spokenAudioPlaying) && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-3 rounded-2xl border flex items-start gap-2.5 ${
                orbState === "clarifying"
                  ? "bg-amber-500/10 border-amber-500/20"
                  : "bg-emerald-500/10 border-emerald-500/20"
              }`}
            >
              <div
                className={`h-5 w-5 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                  orbState === "clarifying"
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-emerald-500/20 text-emerald-300"
                }`}
              >
                <Bot className="h-3 w-3" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] font-mono uppercase ${
                      orbState === "clarifying" ? "text-amber-300" : "text-emerald-300"
                    }`}
                  >
                    KhataFlow Companion (edge-tts)
                  </span>
                  {ttfaLatencyMs && (
                    <span className="text-[10px] font-mono text-white/40">
                      TTFA: {ttfaLatencyMs}ms
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/90 font-medium mt-0.5 leading-relaxed">
                  {payload?.spoken_reply || "Done! Khata update kar diya gaya hai."}
                </p>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Bottom Half: Tactile Itemized Smart Kirana Receipt Card */}
      <div className="glass-panel p-6 relative overflow-hidden flex flex-col flex-1 shadow-2xl">
        {/* Subtle Watermark Receipt Icon */}
        <Receipt className="absolute -bottom-8 -right-8 h-40 w-40 text-white/[0.02] pointer-events-none rotate-12" />

        {/* Receipt Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.15)]">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {selectedCustomer ? `${selectedCustomer.name} - Hisab History` : "Live Itemized Kirana Receipt"}
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" /> AI PARSED
                </span>
              </div>
              <p className="text-xs text-white/50">
                {selectedCustomer
                  ? "Inspecting customer transaction ledger"
                  : "Automatic quantity default & multi-item calculator"}
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
              className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg border ${
                primaryAction.action === "ADD_CREDIT"
                  ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                  : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
              }`}
            >
              {primaryAction.action === "ADD_CREDIT" ? "UDHAAR ENTRY" : "JAMA / CHUKTA"}
            </span>
          )}
        </div>

        {/* Customer & Timestamp Info Strip */}
        <div className="grid grid-cols-2 gap-3 py-3 border-b border-white/[0.06] text-xs">
          <div>
            <span className="text-[10px] text-white/40 block font-mono uppercase tracking-wider mb-0.5">
              Customer Profile
            </span>
            <span className="text-white font-semibold text-xs flex items-center gap-1.5">
              {selectedCustomer ? selectedCustomer.name : primaryAction.customer || "Pooja"}
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

        {/* If user selected a customer on the left, display their real-time transaction ledger */}
        {selectedCustomer ? (
          <div className="flex-1 py-4 overflow-y-auto space-y-2 pr-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block mb-2">
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
          /* Itemized Line Items 4-Column Table: ITEM | QTY | RATE (₹) | TOTAL (₹) */
          <div className="flex-1 py-3 flex flex-col justify-start min-h-0">
            <div className="grid grid-cols-12 text-[10px] font-mono uppercase tracking-wider text-white/40 pb-2 border-b border-white/[0.04] shrink-0">
              <span className="col-span-5">Item</span>
              <span className="col-span-2 text-center">Qty</span>
              <span className="col-span-2 text-right">Rate (₹)</span>
              <span className="col-span-3 text-right">Total (₹)</span>
            </div>

            {/* Scrollable line-items container so long bills can scroll smoothly */}
            <div className="space-y-2 pt-2 overflow-y-auto max-h-56 pr-1">
              <AnimatePresence>
                {lineItems.map((item, idx) => (
                  <motion.div
                    key={`${item.name}-${idx}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    className="grid grid-cols-12 items-center text-xs py-1.5 hover:bg-white/[0.02] rounded px-1 -mx-1 transition-colors"
                  >
                    <div className="col-span-5 flex items-center gap-2 truncate">
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

            {/* Dashed divider */}
            <div className="my-3 border-b border-dashed border-white/15 shrink-0" />

            {/* Grand Total Footer */}
            <div className="space-y-1 text-xs shrink-0">
              <div className="flex justify-between items-baseline pt-1">
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

        {/* Action Buttons: Save to Khata & Clear */}
        {!selectedCustomer && (
          <div className="pt-4 border-t border-white/[0.08] flex items-center gap-3">
            <button
              onClick={() => {
                setConfirmed(true);
                if (onConfirmAction) onConfirmAction(primaryAction);
              }}
              disabled={confirmed}
              className={`flex-1 py-3 px-4 rounded-2xl font-bold text-xs tracking-wide flex items-center justify-center gap-2 transition-all shadow-lg ${
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
              className="px-4 py-3 rounded-2xl bg-white/[0.04] hover:bg-rose-500/10 border border-white/[0.08] hover:border-rose-500/30 text-white/50 hover:text-rose-400 text-xs font-semibold flex items-center gap-1.5 transition-all"
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
            Quick Conversational Scenarios
          </span>
          <span className="text-[10px] text-white/40">One-click testing</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            {
              label: "Multi-item: 200 Maida + 50 Maggi",
              text: "पूजा ने 200 रुपये का मैदा खरीदा, 50 रुपये की Maggi खरीदी। उधार में डाल दो, तो total को calculate करके।",
              type: "udhaar",
            },
            {
              label: "Auto-create New Customer (Suresh)",
              text: "सुरेश के नाम पे 100 रुपये लिख दो",
              type: "new",
            },
            {
              label: "Missing Customer (Clarification test)",
              text: "500 रुपये उधार लिख दो",
              type: "clarify",
            },
            {
              label: "Missing Price (Clarification test)",
              text: "रमेश ने Maggi और आटा लिया",
              type: "clarify",
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
                    chip.type === "new"
                      ? "bg-emerald-400"
                      : chip.type === "clarify"
                      ? "bg-amber-400"
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
