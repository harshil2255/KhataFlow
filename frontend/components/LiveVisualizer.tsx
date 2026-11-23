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
  FileText,
  Mail,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";
import { Customer, Transaction } from "./LedgerCards";
import { useTheme } from "@/context/ThemeContext";
import { InvoiceModal } from "./InvoiceModal";

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
  onDeleteCustomer?: (customerId: number) => void;
  liveBillData?: { customer_id: number; customer: string; amount: number; items: LineItem[] } | null;
  transactions?: Transaction[];
}

// Client-side parser to extract itemized entries from transaction notes or corrections
function parseItemsFromTransactions(txList: Transaction[], customerId: number): LineItem[] {
  const custTx = txList.filter((t) => t.customer_id === customerId);
  const items: LineItem[] = [];

  for (const tx of custTx) {
    if (!tx.notes || tx.notes === "Opening Balance" || tx.notes === "Quick Entry") {
      continue;
    }
    // E.g. "2 Chawal (60rs each), 5 Ande (7.5rs each)"
    const parts = tx.notes.split(",");
    for (const part of parts) {
      const match = part.trim().match(/^([\d.]+)?\s*([^(]+)(?:\(([\d.]+)\s*rs(?:\s*each)?\))?/i);
      if (match) {
        const qty = match[1] ? parseFloat(match[1]) : 1;
        const name = match[2].trim();
        const unit_price = match[3] ? parseFloat(match[3]) : (tx.amount / (qty || 1));
        if (name && !name.toLowerCase().includes("kirana")) {
          items.push({
            name,
            qty,
            unit: "unit",
            unit_price,
            total: Math.round(qty * unit_price * 100) / 100,
          });
        }
      }
    }
  }
  return items;
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
  onDeleteCustomer,
  liveBillData,
  transactions = [],
}) => {
  const { theme } = useTheme();
  const [customerBill, setCustomerBill] = useState<{
    customer: string;
    amount: number;
    items: LineItem[];
  } | null>(null);
  const [loadingBill, setLoadingBill] = useState(false);
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);

  // Sync real-time WebSocket bill data
  useEffect(() => {
    if (liveBillData && selectedCustomer && liveBillData.customer_id === selectedCustomer.id) {
      setCustomerBill({
        customer: liveBillData.customer,
        amount: liveBillData.amount,
        items: liveBillData.items || [],
      });
    }
  }, [liveBillData, selectedCustomer]);

  // Fetch bill for selected customer — ALWAYS fetch fresh from API on customer selection
  useEffect(() => {
    if (!selectedCustomer) {
      setCustomerBill(null);
      return;
    }

    setLoadingBill(true);
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://khataflow-lvvd.onrender.com";
    fetch(`${apiUrl}/api/customers/${selectedCustomer.id}/bill`)
      .then((res) => res.json())
      .then((data) => {
        setCustomerBill({
          customer: data.customer || selectedCustomer.name,
          amount: data.amount ?? selectedCustomer.total_balance,
          items: Array.isArray(data.items) && data.items.length > 0 ? data.items : [],
        });
      })
      .catch(() => {
        // Fallback to local parsing from transaction history
        const parsed = parseItemsFromTransactions(transactions, selectedCustomer.id);
        setCustomerBill({
          customer: selectedCustomer.name,
          amount: selectedCustomer.total_balance,
          items: parsed.length > 0 ? parsed : selectedCustomer.total_balance > 0 ? [
            {
              name: "Pichhla Udhaar",
              qty: 1,
              unit: "hisaab",
              unit_price: selectedCustomer.total_balance,
              total: selectedCustomer.total_balance,
            },
          ] : [],
        });
      })
      .finally(() => setLoadingBill(false));
  }, [selectedCustomer]);

  const payload = useMemo(() => {
    if (!extractedPayload || typeof extractedPayload !== "object") return null;
    return extractedPayload as Record<string, any>;
  }, [extractedPayload]);

  const allExtractedItems: LineItem[] = useMemo(() => {
    if (payload?.actions && Array.isArray(payload.actions)) {
      const all: LineItem[] = [];
      for (const a of payload.actions) {
        if (a.items && Array.isArray(a.items) && a.items.length > 0) {
          all.push(...a.items);
        }
      }
      return all;
    }
    return [];
  }, [payload]);

  const primaryAction: ActionItem | null = useMemo(() => {
    if (payload?.actions && Array.isArray(payload.actions) && payload.actions.length > 0) {
      return payload.actions[0];
    }
    return null;
  }, [payload]);

  const lineItems: LineItem[] = useMemo(() => {
    // 1. If viewing a selected customer and their saved bill has item rows
    if (selectedCustomer && customerBill?.items && customerBill.items.length > 0) {
      return customerBill.items;
    }
    // 2. Fallback to client-side parsing of transaction notes for selected customer
    if (selectedCustomer && transactions && transactions.length > 0) {
      const parsed = parseItemsFromTransactions(transactions, selectedCustomer.id);
      if (parsed.length > 0) return parsed;
    }
    // 3. If voice actions returned parsed items, prioritize showing all extracted items!
    if (allExtractedItems.length > 0) {
      return allExtractedItems;
    }
    if (primaryAction?.items && primaryAction.items.length > 0) {
      return primaryAction.items;
    }
    // 4. Fallback only if customer has an outstanding balance with no specific item breakdown
    if (selectedCustomer && selectedCustomer.total_balance > 0) {
      return [{
        name: "Pichhla Udhaar",
        qty: 1,
        unit: "hisaab",
        unit_price: selectedCustomer.total_balance,
        total: selectedCustomer.total_balance
      }];
    }
    // Default when no customer selected and no active speech: empty list
    return [];
  }, [allExtractedItems, primaryAction, selectedCustomer, customerBill, transactions]);

  const grandTotal = useMemo(() => {
    if (selectedCustomer && customerBill) {
      return customerBill.amount;
    }
    if (selectedCustomer) {
      return selectedCustomer.total_balance;
    }
    if (lineItems.length > 0) {
      return lineItems.reduce((acc, curr) => acc + (curr.total || 0), 0);
    }
    if (primaryAction?.amount) {
      return primaryAction.amount;
    }
    return 0;
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
                Khata Voice Companion <span className="text-[10px] font-mono text-white/40">• Spatial Mode</span>
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

          {/* Floating Glass Chat Bubble: Left (Voice Assistant status) */}
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="absolute left-1 top-2 max-w-[175px] p-2 rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 shadow-lg text-xs"
          >
            <div className="flex items-center gap-1.5 text-[9px] text-emerald-400 font-mono mb-0.5">
              <Sparkles className="h-2.5 w-2.5" /> Dukaan Saathi
            </div>
            <p className="text-white/80 text-[10px] leading-tight">
              {selectedCustomer
                ? `${selectedCustomer.name} ji ka ₹${selectedCustomer.total_balance} baaki hai...`
                : "Bol kar udhaar ya jama darj karein..."}
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
          {grandTotal > 0 && (
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
          )}
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
                {selectedCustomer ? `${selectedCustomer.name} (#KF-${selectedCustomer.id})` : (primaryAction?.customer ? `${primaryAction.customer} (#KF-LIVE)` : "#KF-LIVE")}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Create Invoice & Send to Gmail button */}
            <button
              onClick={() => setIsInvoiceOpen(true)}
              className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-semibold flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
              title="Create Invoice and Redirect to Gmail"
            >
              <Mail className="h-3.5 w-3.5" />
              <span>Invoice / Gmail</span>
              <ExternalLink className="h-2.5 w-2.5 opacity-60" />
            </button>

            {selectedCustomer && (
              <>
                <button
                  onClick={onClearSelectedCustomer}
                  className="px-2 py-0.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/60 text-[10px] flex items-center gap-1 transition-colors"
                >
                  <X className="h-3 w-3" /> Clear Selection
                </button>
                {onDeleteCustomer && (
                  <button
                    onClick={() => {
                      if (confirm(`Kya aap sach me ${selectedCustomer.name} ko delete karna chahte hain?`)) {
                        onDeleteCustomer(selectedCustomer.id);
                      }
                    }}
                    className="px-2 py-0.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 text-[10px] flex items-center gap-1 transition-colors"
                    title="Delete customer"
                  >
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                )}
              </>
            )}
            {lineItems.length > 0 || grandTotal > 0 ? (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold flex items-center gap-1">
                <Sparkles className="h-2.5 w-2.5" /> Bill Generated
              </span>
            ) : (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/10 text-white/40 flex items-center gap-1">
                Receipt Ready
              </span>
            )}
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
              <div className="py-8 flex flex-col items-center justify-center text-center text-white/40">
                <Loader2 className="h-5 w-5 mb-1.5 animate-spin text-emerald-400" />
                <p className="text-xs">Loading customer bill...</p>
              </div>
            ) : lineItems.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center text-center text-white/40 space-y-1.5">
                <Receipt className="h-7 w-7 opacity-30 text-emerald-400" />
                <p className="text-xs font-semibold text-white/70">
                  {selectedCustomer ? `${selectedCustomer.name} ka hisaab chukta hai` : "No active receipt"}
                </p>
                <p className="text-[10px] text-white/35 max-w-[240px]">
                  {selectedCustomer
                    ? "Is grahak ka koi purana ya naya udhaar baaki nahi hai."
                    : "Tap mic to record an order or select a customer to view their ledger receipt."}
                </p>
              </div>
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
                    ₹{Math.round((item.unit_price + Number.EPSILON) * 100) / 100}
                  </span>
                  <span className="col-span-3 text-right text-white font-mono font-semibold tabular-nums">
                    ₹{Math.round((item.total + Number.EPSILON) * 100) / 100}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer Banner: Full-width rich emerald gradient bar with Grand Total */}
        <div className="pt-2 shrink-0 flex items-center gap-2">
          <div className="flex-1 p-3 rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 shadow-lg flex items-center justify-between text-slate-950">
            <div className="flex items-center gap-2">
              <FileCheck className="h-4 w-4" />
              <span className="font-bold text-xs tracking-wide uppercase">Grand Total</span>
            </div>
            <span className="text-xl font-extrabold font-mono tabular-nums tracking-tight">
              ₹{(Math.round((grandTotal + Number.EPSILON) * 100) / 100).toLocaleString("en-IN")}
            </span>
          </div>

          <button
            onClick={() => setIsInvoiceOpen(true)}
            className="h-full px-4 py-3 rounded-2xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white flex items-center gap-2 text-xs font-bold transition-all shadow-md active:scale-95"
            title="Generate Official Invoice & Send via Gmail"
          >
            <Mail className="h-4 w-4 text-emerald-400" />
            <span className="hidden sm:inline">Send Invoice</span>
          </button>
        </div>
      </div>

      {/* Invoice Modal with 1-click Gmail Redirect */}
      <AnimatePresence>
        {isInvoiceOpen && (
          <InvoiceModal
            key="active-live-invoice-modal"
            isOpen={isInvoiceOpen}
            onClose={() => setIsInvoiceOpen(false)}
            customer={
              selectedCustomer || {
                id: 1,
                name: primaryAction?.customer || "Walk-in Grahak",
                phone: null,
                total_balance: grandTotal,
                created_at: "",
              }
            }
            items={lineItems}
            grandTotal={grandTotal}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
