"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  Phone,
  Receipt,
  Sparkles,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle
} from "lucide-react";

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  total_balance: number;
  created_at: string;
}

export interface Transaction {
  id: number;
  customer_id: number;
  customer_name?: string;
  amount: number;
  type: "CREDIT" | "PAYMENT" | "CORRECTION";
  notes?: string;
  created_at: string;
}

interface LedgerCardsProps {
  customers: Customer[];
  transactions: Transaction[];
  lastUpdatedCustomerId?: number | null;
  onSelectCustomer?: (customer: Customer) => void;
}

const AVATAR_GRADIENTS = [
  "from-emerald-500/30 to-teal-600/30 text-emerald-300 border-emerald-500/40",
  "from-violet-500/30 to-purple-600/30 text-purple-300 border-purple-500/40",
  "from-cyan-500/30 to-blue-600/30 text-cyan-300 border-cyan-500/40",
  "from-rose-500/30 to-pink-600/30 text-rose-300 border-rose-500/40",
  "from-amber-500/30 to-orange-600/30 text-amber-300 border-amber-500/40",
];

export const LedgerCards: React.FC<LedgerCardsProps> = ({
  customers,
  transactions,
  lastUpdatedCustomerId,
  onSelectCustomer,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<"ALL" | "CREDIT_ONLY" | "CLEAR_ONLY">("ALL");

  const filteredCustomers = customers.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.phone && c.phone.includes(searchTerm));

    if (!matchesSearch) return false;
    if (filterType === "CREDIT_ONLY") return c.total_balance > 0;
    if (filterType === "CLEAR_ONLY") return c.total_balance <= 0;
    return true;
  });

  const getMonogram = (name: string) => {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const getAvatarGradient = (id: number) => {
    return AVATAR_GRADIENTS[id % AVATAR_GRADIENTS.length];
  };

  return (
    <div className="flex flex-col h-full bg-[#0B0F19]/60 backdrop-blur-2xl border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.6)] rounded-3xl overflow-hidden relative">
      {/* Top Header & Search Area */}
      <div className="p-5 pb-3 border-b border-white/[0.06] space-y-4">
        {/* Title & Quick Stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Users className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-white">
                Grahak Khata
              </h2>
              <p className="text-[11px] text-slate-400 font-medium">
                {customers.length} Registered Ledgers
              </p>
            </div>
          </div>

          <div className="text-[11px] font-mono text-slate-400 tabular-nums">
            Active: <span className="text-emerald-400 font-semibold">{filteredCustomers.length}</span>
          </div>
        </div>

        {/* Search Bar + Segmented Tabs */}
        <div className="space-y-2.5">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Grahak ya phone khojein..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]"
            />
          </div>

          {/* Segmented Pill Tabs with Framer Motion layoutId */}
          <div className="grid grid-cols-3 gap-1 p-1 bg-black/40 border border-white/[0.06] rounded-xl">
            {(
              [
                { id: "ALL", label: "Sabhi" },
                { id: "CREDIT_ONLY", label: "Udhaar" },
                { id: "CLEAR_ONLY", label: "Chukta" },
              ] as const
            ).map((tab) => {
              const active = filterType === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setFilterType(tab.id)}
                  className={`relative py-1.5 text-[11px] font-medium rounded-lg transition-colors flex items-center justify-center ${
                    active ? "text-white" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {active && (
                    <motion.div
                      layoutId="activeFilterTab"
                      className="absolute inset-0 bg-white/[0.09] border border-white/[0.12] rounded-lg shadow-sm"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Customer List Section */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        <AnimatePresence mode="popLayout">
          {filteredCustomers.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-44 flex flex-col items-center justify-center text-center p-6 text-slate-500"
            >
              <div className="h-10 w-10 rounded-2xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-center mb-2">
                <Search className="h-4 w-4 text-slate-600" />
              </div>
              <p className="text-xs font-medium text-slate-400">Koi grahak nahi mila</p>
              <p className="text-[11px] text-slate-600 mt-0.5">Bol kar naya ledger banayein</p>
            </motion.div>
          ) : (
            filteredCustomers.map((cust) => {
              const isUpdated = lastUpdatedCustomerId === cust.id;
              const isCredit = cust.total_balance > 0;
              const isAdvance = cust.total_balance < 0;

              return (
                <motion.div
                  key={cust.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  onClick={() => onSelectCustomer?.(cust)}
                  className={`group relative p-3.5 rounded-2xl border transition-all duration-200 cursor-pointer ${
                    isUpdated
                      ? "bg-emerald-500/10 border-emerald-400/60 shadow-[0_0_24px_rgba(16,185,129,0.25)]"
                      : "bg-[#0E1322]/50 hover:bg-[#141B30]/70 border-white/[0.06] hover:border-white/[0.18] hover:-translate-y-0.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    {/* Left: Avatar + Details */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br border flex items-center justify-center font-bold text-xs tracking-wider ${getAvatarGradient(
                          cust.id
                        )}`}
                      >
                        {getMonogram(cust.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-xs tracking-tight text-white truncate group-hover:text-emerald-300 transition-colors">
                            {cust.name}
                          </span>
                          {isUpdated && (
                            <span className="flex h-1.5 w-1.5 relative shrink-0">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 text-[11px] font-mono text-slate-400">
                          <Phone className="h-2.5 w-2.5 text-slate-500" />
                          <span className="tabular-nums tracking-tight">
                            {cust.phone || "No phone"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Currency & Status Pill */}
                    <div className="text-right shrink-0">
                      <div
                        className={`font-mono text-sm font-bold tracking-tight tabular-nums ${
                          isCredit
                            ? "text-[#FB7185]"
                            : isAdvance
                            ? "text-[#38BDF8]"
                            : "text-[#34D399]"
                        }`}
                      >
                        ₹{Math.abs(cust.total_balance).toLocaleString("en-IN")}
                      </div>
                      <div className="mt-1">
                        {isCredit ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium tracking-wide uppercase bg-[#881337]/30 text-[#FB7185] border border-[#FB7185]/30">
                            Udhaar Baaki
                          </span>
                        ) : isAdvance ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium tracking-wide uppercase bg-sky-950/40 text-sky-400 border border-sky-800/40">
                            Advance
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-medium tracking-wide uppercase bg-[#064E3B]/30 text-[#34D399] border border-[#34D399]/30">
                            Chukta
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Timeline Section: Recent Activity */}
      <div className="p-4 pt-3 border-t border-white/[0.06] bg-black/30 backdrop-blur-md">
        <div className="flex items-center justify-between mb-2.5 px-0.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <Clock className="h-3 w-3 text-emerald-400" />
            <span>Recent Activity</span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">Live Timeline</span>
        </div>

        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-0.5">
          {transactions.length === 0 ? (
            <div className="text-center py-4 text-[11px] text-slate-500">
              No recent transactions
            </div>
          ) : (
            transactions.slice(0, 5).map((t) => {
              const isCredit = t.type === "CREDIT";
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-2 rounded-xl bg-white/[0.02] border border-white/[0.04] text-xs hover:border-white/[0.08] transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`h-6 w-6 rounded-lg flex items-center justify-center shrink-0 ${
                        isCredit
                          ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      }`}
                    >
                      {isCredit ? (
                        <ArrowUpRight className="h-3 w-3" />
                      ) : (
                        <ArrowDownLeft className="h-3 w-3" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-slate-200 font-medium text-[11px] truncate">
                        {t.customer_name || `Customer #${t.customer_id}`}
                      </p>
                      <p className="text-[10px] text-slate-500 truncate max-w-[140px]">
                        {t.notes || (isCredit ? "Goods on credit" : "Debt repayment")}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className={`font-mono text-xs font-bold tabular-nums ${
                        isCredit ? "text-[#FB7185]" : "text-[#34D399]"
                      }`}
                    >
                      {isCredit ? "+" : "-"}₹{t.amount.toLocaleString("en-IN")}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
