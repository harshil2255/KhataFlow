"use client";

import React, { useState, useMemo } from "react";
import { Customer, Transaction } from "./LedgerCards";
import { Search, FileText, ChevronDown, ChevronRight, CheckCircle2, Clock, AlertCircle, ArrowUpRight, Download, Filter } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface BillsTabProps {
  customers: Customer[];
  transactions: Transaction[];
  onSelectCustomerBill: (customer: Customer) => void;
}

export const BillsTab: React.FC<BillsTabProps> = ({ customers, transactions, onSelectCustomerBill }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "unpaid" | "settled" | "advance">("all");
  const [expandedCustId, setExpandedCustId] = useState<number | null>(null);

  // Group transactions by customer
  const customerBills = useMemo(() => {
    return customers.map((c) => {
      const custTxs = transactions.filter((t) => t.customer_id === c.id);
      const isUdhaar = c.total_balance > 0;
      const isAdvance = c.total_balance < 0;
      const isSettled = c.total_balance === 0;

      let status = "settled";
      if (isUdhaar) status = "unpaid";
      else if (isAdvance) status = "advance";

      return {
        customer: c,
        transactions: custTxs,
        status,
        totalItemsCount: custTxs.length,
      };
    });
  }, [customers, transactions]);

  const filteredBills = useMemo(() => {
    return customerBills.filter((bill) => {
      const matchesSearch =
        bill.customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (bill.customer.phone && bill.customer.phone.includes(searchTerm));

      if (!matchesSearch) return false;
      if (filterStatus === "all") return true;
      return bill.status === filterStatus;
    });
  }, [customerBills, searchTerm, filterStatus]);

  const toggleExpand = (id: number) => {
    setExpandedCustId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="h-full w-full flex flex-col space-y-4 overflow-hidden">
      {/* Top Header & Search / Filters Bar */}
      <div className="p-4 rounded-3xl glass-panel flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <FileText className="h-4 w-4 text-emerald-400" /> Master Billing Ledger
            </h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.08] text-white/60 border border-white/10">
              {filteredBills.length} Invoices
            </span>
          </div>
          <p className="text-xs text-white/40">Itemized bills and transaction trails for all registered shop accounts</p>
        </div>

        {/* Search & Status Pills */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
            <input
              type="text"
              placeholder="Search customer, item, invoice..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400"
            />
          </div>

          {/* Segmented Filter Pills */}
          <div className="flex p-1 rounded-xl bg-black/40 border border-white/[0.08]">
            {(
              [
                { id: "all", label: "All Bills" },
                { id: "unpaid", label: "Udhaar" },
                { id: "settled", label: "Chukta" },
                { id: "advance", label: "Advance" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilterStatus(tab.id)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  filterStatus === tab.id
                    ? "bg-white/[0.12] text-white shadow-sm border border-white/10"
                    : "text-white/40 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Master Bills Table */}
      <div className="flex-1 rounded-3xl glass-panel p-4 overflow-y-auto space-y-2.5">
        {/* Table Header */}
        <div className="grid grid-cols-12 text-[10px] font-mono uppercase tracking-wider text-white/40 px-3 pb-2 border-b border-white/[0.06]">
          <span className="col-span-1">Ref</span>
          <span className="col-span-3">Customer</span>
          <span className="col-span-3">Items Summary</span>
          <span className="col-span-2 text-center">Status</span>
          <span className="col-span-2 text-right">Balance Due (₹)</span>
          <span className="col-span-1 text-right">Action</span>
        </div>

        {filteredBills.length === 0 ? (
          <div className="py-16 text-center text-white/40 text-xs">Koi bill ya customer nahi mila.</div>
        ) : (
          filteredBills.map(({ customer, transactions: custTxs, status }) => {
            const isExpanded = expandedCustId === customer.id;
            return (
              <div
                key={customer.id}
                className={`rounded-2xl border transition-all ${
                  isExpanded ? "bg-white/[0.05] border-white/20" : "bg-white/[0.02] hover:bg-white/[0.04] border-white/[0.06]"
                }`}
              >
                {/* Main Row */}
                <div
                  onClick={() => toggleExpand(customer.id)}
                  className="grid grid-cols-12 items-center px-3 py-3 cursor-pointer text-xs select-none"
                >
                  <span className="col-span-1 font-mono text-white/40 text-[11px]">#KF-{customer.id}</span>

                  <div className="col-span-3 flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-400/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center font-bold text-[11px] text-emerald-300">
                      {customer.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <span className="text-white font-semibold block">{customer.name}</span>
                      <span className="text-[10px] text-white/40 font-mono">{customer.phone || "No phone"}</span>
                    </div>
                  </div>

                  <div className="col-span-3 text-white/70 truncate text-[11px]">
                    {custTxs.length > 0 ? (
                      custTxs.slice(0, 2).map((t) => t.notes || "Kirana Samaan").join(", ")
                    ) : (
                      <span className="text-white/30 italic">No transactions recorded</span>
                    )}
                  </div>

                  <div className="col-span-2 flex justify-center">
                    <span
                      className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-lg border ${
                        status === "unpaid"
                          ? "bg-rose-500/15 border-rose-500/30 text-rose-300"
                          : status === "advance"
                          ? "bg-sky-500/15 border-sky-500/30 text-sky-300"
                          : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                      }`}
                    >
                      {status === "unpaid" ? "UDHAAR" : status === "advance" ? "ADVANCE" : "CHUKTA"}
                    </span>
                  </div>

                  <div className="col-span-2 text-right font-mono font-bold tabular-nums text-sm">
                    <span
                      className={
                        status === "unpaid" ? "text-rose-400" : status === "advance" ? "text-sky-400" : "text-emerald-400"
                      }
                    >
                      {status === "advance" ? "+" : ""}₹{Math.abs(customer.total_balance)}
                    </span>
                  </div>

                  <div className="col-span-1 flex justify-end">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCustomerBill(customer);
                      }}
                      className="p-1 rounded-lg bg-white/[0.06] hover:bg-emerald-500 hover:text-slate-950 text-white/70 transition-colors"
                      title="Open in Smart Receipt"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expandable Itemized Trail */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="px-4 pb-3 pt-1 border-t border-white/[0.04] space-y-1.5"
                    >
                      <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block">
                        Detailed Ledger Trail
                      </span>
                      {custTxs.length === 0 ? (
                        <p className="text-xs text-white/40 italic py-2">No transaction history found.</p>
                      ) : (
                        <div className="space-y-1">
                          {custTxs.map((t) => (
                            <div
                              key={t.id}
                              className="flex items-center justify-between text-xs py-1 px-2.5 rounded-lg bg-black/20 border border-white/[0.03]"
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    t.type === "CREDIT" ? "bg-rose-400" : "bg-emerald-400"
                                  }`}
                                />
                                <span className="text-white/80">{t.notes || "Kirana Items"}</span>
                                <span className="text-[10px] text-white/30 font-mono">{t.created_at}</span>
                              </div>
                              <span
                                className={`font-mono font-bold tabular-nums ${
                                  t.type === "CREDIT" ? "text-rose-400" : "text-emerald-400"
                                }`}
                              >
                                {t.type === "CREDIT" ? "+" : "-"}₹{t.amount}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
