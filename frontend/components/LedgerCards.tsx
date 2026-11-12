"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Users, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Search, 
  Phone, 
  Receipt
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
}

export const LedgerCards: React.FC<LedgerCardsProps> = ({
  customers,
  transactions,
  lastUpdatedCustomerId,
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

  const totalOutstanding = customers.reduce(
    (acc, c) => acc + (c.total_balance > 0 ? c.total_balance : 0),
    0
  );

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-800 text-slate-100 overflow-hidden">
      {/* Top Banner / Store Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/60 backdrop-blur">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="h-9 w-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold">
              ₹
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                KhataFlow <span className="text-xs font-medium px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400">Kirana Pro</span>
              </h1>
              <p className="text-xs text-slate-400">Indic Voice Ledger & Smart Hisab</p>
            </div>
          </div>

          <div className="flex gap-2">
            <div className="px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-800/60 text-right">
              <span className="text-[10px] uppercase font-bold text-red-400 block tracking-wider">Kul Udhaar (Receivable)</span>
              <span className="text-sm font-extrabold text-red-400">₹{totalOutstanding.toLocaleString("en-IN")}</span>
            </div>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Grahak ya phone khojein..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-800/80 border border-slate-700/80 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div className="flex gap-1 bg-slate-800/80 p-1 rounded-lg border border-slate-700/80 text-xs">
            <button
              onClick={() => setFilterType("ALL")}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === "ALL" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Sabhi
            </button>
            <button
              onClick={() => setFilterType("CREDIT_ONLY")}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === "CREDIT_ONLY" ? "bg-red-600 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Udhaar
            </button>
            <button
              onClick={() => setFilterType("CLEAR_ONLY")}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition ${
                filterType === "CLEAR_ONLY" ? "bg-emerald-600 text-white" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Chukta
            </button>
          </div>
        </div>
      </div>

      {/* Main Customer Ledger Cards List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1 mb-1 font-semibold uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Grahak Khata ({filteredCustomers.length})
          </span>
          <span>Pending Balance</span>
        </div>

        <AnimatePresence>
          {filteredCustomers.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              Koi grahak nahi mila. Naya bol kar darj karein.
            </div>
          ) : (
            filteredCustomers.map((cust) => {
              const isUpdated = lastUpdatedCustomerId === cust.id;
              const isCredit = cust.total_balance > 0;
              const isAdvance = cust.total_balance < 0;

              return (
                <motion.div
                  key={cust.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: isUpdated ? [1, 1.02, 1] : 1,
                  }}
                  transition={{ duration: 0.3 }}
                  className={`p-3.5 rounded-xl border transition-all ${
                    isUpdated
                      ? "border-emerald-400 bg-emerald-950/40 shadow-lg shadow-emerald-950/50"
                      : "border-slate-800/80 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-800/30"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div
                        className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm ${
                          isCredit
                            ? "bg-red-500/20 text-red-400 border border-red-500/30"
                            : isAdvance
                            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                            : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        }`}
                      >
                        {cust.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-white">{cust.name}</span>
                          {isUpdated && (
                            <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                          )}
                        </div>
                        <div className="flex items-center text-xs text-slate-400 gap-1.5 mt-0.5">
                          <Phone className="h-3 w-3" />
                          <span>{cust.phone || "No Phone Registered"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <div
                        className={`text-base font-extrabold flex items-center justify-end ${
                          isCredit
                            ? "text-red-400"
                            : isAdvance
                            ? "text-blue-400"
                            : "text-emerald-400"
                        }`}
                      >
                        ₹{Math.abs(cust.total_balance).toLocaleString("en-IN")}
                      </div>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-block mt-0.5 ${
                          isCredit
                            ? "bg-red-950 text-red-300 border border-red-800/40"
                            : isAdvance
                            ? "bg-blue-950 text-blue-300 border border-blue-800/40"
                            : "bg-emerald-950 text-emerald-300 border border-emerald-800/40"
                        }`}
                      >
                        {isCredit ? "Udhaar Baaki" : isAdvance ? "Advance Jama" : "Hisaab Nil"}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Recent Activity Ticker */}
      <div className="p-3 bg-slate-950 border-t border-slate-800">
        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-semibold mb-2">
          <Receipt className="h-3.5 w-3.5 text-emerald-400" />
          <span>Haal Hi Ke Saude (Recent Transactions)</span>
        </div>
        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
          {transactions.slice(0, 5).map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-900 border border-slate-800/70"
            >
              <div className="flex items-center gap-2">
                {t.type === "CREDIT" ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-400" />
                )}
                <div>
                  <span className="font-medium text-slate-200">{t.customer_name || `Customer #${t.customer_id}`}</span>
                  <span className="text-[10px] text-slate-400 ml-1.5 truncate max-w-[120px] inline-block align-bottom">
                    {t.notes || t.type}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span
                  className={`font-bold ${
                    t.type === "CREDIT" ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {t.type === "CREDIT" ? "+" : "-"}₹{t.amount}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
