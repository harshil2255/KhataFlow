"use client";

import React, { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  Sparkles,
  Receipt,
  FileCheck,
  CheckCircle2,
  User,
  Radio,
  X,
} from "lucide-react";
import { Customer } from "./LedgerCards";
import { useTheme } from "@/context/ThemeContext";

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
  selectedCustomer,
  onClearSelectedCustomer,
}) => {
  const { theme } = useTheme();
  const [customerBill, setCustomerBill] = useState<{
    customer: string;
    amount: number;
    items: LineItem[];
  } | null>(null);
  const [loadingBill, setLoadingBill] = useState(false);

  // Fetch bill for selected customer
  useEffect(() => {
    if (selectedCustomer) {
      setLoadingBill(true);
      fetch(`http://localhost:8000/api/customers/${selectedCustomer.id}/bill`)
        .then((res) => res.json())
        .then((data) => {
          setCustomerBill({
            customer: data.customer || selectedCustomer.name,
            amount: data.amount ?? selectedCustomer.total_balance,
            items: data.items || [],
          });
        })
        .catch(() => {
          setCustomerBill({
            customer: selectedCustomer.name,
            amount: selectedCustomer.total_balance,
            items: [
              {
                name: "Kirana Items",
                qty: 1,
                unit: "lot",
                unit_price: selectedCustomer.total_balance,
                total: selectedCustomer.total_balance,
              },
            ],
          });
        })
        .finally(() => setLoadingBill(false));
    } else {
      setCustomerBill(null);
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
      customer: "Krishna",
      amount: 200,
      notes: "Chawal aur Maggi",
      items: [
        { name: "Chawal", qty: 2, unit: "kg", unit_price: 60, total: 120 },
        { name: "Maggi", qty: 1, unit: "pkt", unit_price: 20, total: 20 },
        { name: "Doodh", qty: 1, unit: "ltr", unit_price: 60, total: 60 },
      ],
    };
  }, [payload]);

  const lineItems: LineItem[] = useMemo(() => {
    if (selectedCustomer && customerBill?.items && customerBill.items.length > 0) {
      return customerBill.items;
    }
    if (primaryAction.items && primaryAction.items.length > 0) {
      return primaryAction.items;
    }
    const tot = selectedCustomer ? selectedCustomer.total_balance : primaryAction.amount || 200;
    return [{ name: "Kirana Items", qty: 1, unit: "lot", unit_price: tot, total: tot }];
  }, [primaryAction, selectedCustomer, customerBill]);

  const grandTotal = useMemo(() => {
    if (selectedCustomer && customerBill) {
      return customerBill.amount;
    }
    if (lineItems.length > 0) {
      return lineItems.reduce((acc, curr) => acc + (curr.total || 0), 0);
    }
    return primaryAction.amount || 200;
  }, [lineItems, primaryAction, selectedCustomer, customerBill]);

  // Orb State
  const orbState = isRecording
    ? "listening"
    : spokenAudioPlaying
    ? "speaking"
    : transcript && !isFinalTranscript
    ? "thinking"
    : "idle";

  return (
    <div className="h-full w-full flex flex-col gap-3 overflow-hidden select-none">
      {/* Top Card (48% Height): Luminous 3D AI Call Stage with Floating Bubbles */}
      <div
        className="h-[48%] rounded-3xl relative overflow-hidden flex flex-col justify-between p-4"
        style={{
          backgroundColor: `rgba(17, 21, 34, ${theme.glassOpacity})`,
          backdropFilter: `blur(${theme.glassBlur}px)`,
          WebkitBackdropFilter: `blur(${theme.glassBlur}px)`,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08), 0 20px 50px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Header bar */}
        <div className="flex items-center justify-between z-10 shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-emerald-400">
              <Radio className="h-3.5 w-3.5 animate-pulse" />
            </div>
            <div>
              <span className="text-xs font-bold text-white tracking-tight flex items-center gap-1.5">
                AI Voice Companion <span className="text-[10px] font-mono text-white/40">• Spatial Call Mode</span>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {ttfaLatencyMs !== null && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/10 text-white/60">
                {ttfaLatencyMs} ms
              </span>
            )}
            <span
              className={`text-[9px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
                orbState === "listening"
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30 animate-pulse"
                  : orbState === "speaking"
                  ? "bg-purple-500/20 text-purple-300 border border-purple-500/30 animate-pulse"
                  : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
              }`}
            >
              {orbState}
            </span>
          </div>
        </div>

        {/* Centerpiece: Living 3D Glowing Emerald-Cyan-Violet Plasma Orb */}
        <div className="relative flex-1 flex items-center justify-center my-0.5 min-h-0">
          {/* Concentric Soft Light Rings */}
          <motion.div
            animate={{
              scale: orbState === "listening" ? [1, 1.25, 1] : [1, 1.08, 1],
              opacity: [0.15, 0.35, 0.15],
            }}
            transition={{ repeat: Infinity, duration: 3.5, ease: "easeInOut" }}
            className="absolute w-40 h-40 rounded-full border border-emerald-400/20 pointer-events-none"
          />
          <motion.div
            animate={{
              scale: orbState === "speaking" ? [1, 1.35, 1] : [1, 1.15, 1],
              opacity: [0.1, 0.25, 0.1],
            }}
            transition={{ repeat: Infinity, duration: 4.5, ease: "easeInOut" }}
            className="absolute w-52 h-52 rounded-full border border-cyan-400/15 pointer-events-none"
          />

          {/* Core 3D Plasma Orb */}
          <motion.div
            animate={{
              rotate: [0, 180, 360],
              scale: orbState === "listening" ? [1, 1.12, 0.98, 1] : orbState === "speaking" ? [1, 1.15, 1] : [1, 1.04, 1],
            }}
            transition={{ repeat: Infinity, duration: 8, ease: "easeInOut" }}
            className="w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-400 via-teal-300 to-indigo-500 shadow-[0_0_50px_rgba(52,211,153,0.5)] flex items-center justify-center relative cursor-pointer"
            onClick={onToggleRecording}
          >
            <div className="absolute inset-1 rounded-full bg-gradient-to-br from-cyan-300 via-emerald-500 to-violet-600 blur-[2px] opacity-90" />
            <div className="relative z-10 text-slate-950 font-bold">
              {isRecording ? <Mic className="h-5 w-5 text-white animate-pulse" /> : <Sparkles className="h-5 w-5 text-slate-950" />}
            </div>
          </motion.div>

          {/* Floating Glass Chat Bubble: Left (AI Voice status) */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="absolute left-1 top-2 max-w-[175px] p-2 rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 shadow-lg text-xs"
          >
            <div className="flex items-center gap-1.5 text-[9px] text-emerald-400 font-mono mb-0.5">
              <Sparkles className="h-2.5 w-2.5" /> AI Saathi
            </div>
            <p className="text-white/80 text-[10px] leading-tight">
              {selectedCustomer
                ? `${selectedCustomer.name} ji ka ₹${selectedCustomer.total_balance} baaki hai...`
                : "Krishna ji ka ₹120 baaki hai..."}
            </p>
          </motion.div>

          {/* Floating Glass Chat Bubble: Top-Right (User Speech) */}
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="absolute right-1 top-1 max-w-[185px] p-2 rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 shadow-lg text-xs"
          >
            <div className="flex items-center gap-1.5 text-[9px] text-cyan-400 font-mono mb-0.5">
              <User className="h-2.5 w-2.5" /> Shopkeeper
            </div>
            <p className="text-white font-medium text-[10px] leading-tight truncate">
              {transcript ? `“${transcript}”` : "“2 kg chawal likh do...”"}
            </p>
          </motion.div>

          {/* Floating Glass Chat Bubble: Bottom-Right (AI Confirmation) */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute right-2 bottom-0 p-1.5 px-2.5 rounded-xl bg-emerald-500/20 backdrop-blur-xl border border-emerald-500/30 shadow-lg flex items-center gap-1.5 text-xs"
          >
            <CheckCircle2 className="h-3 w-3 text-emerald-300" />
            <span className="text-[10px] text-white font-semibold">
              Ho gaya! Kul ₹{grandTotal}
            </span>
          </motion.div>
        </div>

        {/* Bottom transcript bar */}
        <div className="z-10 text-center shrink-0">
          <p className="text-[10px] text-white/50 truncate">
            {transcript ? `Transcript: "${transcript}"` : "Tap mic or say: 'Krishna ka 2 kg chawal likh do'"}
          </p>
        </div>
      </div>

      {/* Bottom Card (52% Height): Smart Kirana Receipt */}
      <div
        className="h-[52%] rounded-3xl relative overflow-hidden flex flex-col justify-between p-4"
        style={{
          backgroundColor: `rgba(17, 21, 34, ${theme.glassOpacity})`,
          backdropFilter: `blur(${theme.glassBlur}px)`,
          WebkitBackdropFilter: `blur(${theme.glassBlur}px)`,
          border: "1px solid rgba(255, 255, 255, 0.08)",
          boxShadow: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08), 0 20px 50px rgba(0, 0, 0, 0.5)",
        }}
      >
        {/* Receipt Header */}
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Receipt className="h-3.5 w-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white tracking-tight">Smart Kirana Receipt</h3>
              <span className="text-[10px] text-white/40 font-mono">
                {selectedCustomer ? `${selectedCustomer.name} (#KF-${selectedCustomer.id})` : "#KF-LIVE"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {selectedCustomer && (
              <button
                onClick={onClearSelectedCustomer}
                className="px-2 py-0.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/60 text-[10px] flex items-center gap-1 transition-colors"
              >
                <X className="h-3 w-3" /> Clear Selection
              </button>
            )}
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5" /> Bill Generated
            </span>
          </div>
        </div>

        {/* 4-Column Table */}
        <div className="flex-1 overflow-hidden flex flex-col pt-1.5 min-h-0">
          <div className="grid grid-cols-12 text-[10px] font-mono uppercase tracking-wider text-white/40 pb-1.5 border-b border-white/[0.04] shrink-0">
            <span className="col-span-5">Item</span>
            <span className="col-span-2 text-center">Qty</span>
            <span className="col-span-2 text-right">Rate</span>
            <span className="col-span-3 text-right">Total</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pt-1 pr-1">
            {loadingBill ? (
              <div className="py-6 text-center text-xs text-white/40">Loading customer bill...</div>
            ) : lineItems.length === 0 ? (
              <div className="py-6 text-center text-xs text-white/40">No items on this bill.</div>
            ) : (
              lineItems.map((item, idx) => (
                <div
                  key={`${item.name}-${idx}`}
                  className="grid grid-cols-12 items-center text-xs py-1 px-1 rounded hover:bg-white/[0.03] transition-colors"
                >
                  <div className="col-span-5 flex items-center gap-1.5 truncate">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
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
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer Banner: Full-width rich emerald gradient bar with Grand Total */}
        <div className="pt-2 shrink-0">
          <div className="p-3 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 shadow-lg flex items-center justify-between text-slate-950">
            <div className="flex items-center gap-2">
              <FileCheck className="h-4 w-4" />
              <span className="font-bold text-xs tracking-wide uppercase">Grand Total</span>
            </div>
            <span className="text-xl font-extrabold font-mono tabular-nums tracking-tight">
              ₹{grandTotal.toLocaleString("en-IN")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
