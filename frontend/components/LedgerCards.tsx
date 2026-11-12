"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  Phone,
  UserPlus,
  Receipt,
  Sparkles,
  Clock,
  X,
  ChevronRight,
  TrendingUp,
  Trash2,
  Edit2,
  Check,
} from "lucide-react";

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  total_balance: number;
  created_at: string;
  is_new?: boolean;
}

export interface Transaction {
  id: number;
  customer_id: number;
  customer_name: string;
  amount: number;
  type: string;
  notes: string | null;
  created_at: string;
}

interface LedgerCardsProps {
  customers: Customer[];
  transactions: Transaction[];
  lastUpdatedCustomerId: number | null;
  onCustomerSelect?: (customer: Customer) => void;
  selectedCustomerId?: number | null;
  onAddCustomer: (customerData: { name: string; phone: string; opening_balance: number }) => Promise<void>;
  onDeleteCustomer?: (customerId: number) => Promise<void>;
  onUpdateCustomer?: (customerId: number, data: { name: string; phone?: string }) => Promise<void>;
}

export const LedgerCards: React.FC<LedgerCardsProps> = ({
  customers,
  transactions,
  lastUpdatedCustomerId,
  onCustomerSelect,
  selectedCustomerId,
  onAddCustomer,
  onDeleteCustomer,
  onUpdateCustomer,
}) => {
  const [filter, setFilter] = useState<"all" | "credit" | "settled">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newOpeningBal, setNewOpeningBal] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit customer state
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const filteredCustomers = useMemo(() => {
    return customers.filter((cust) => {
      const matchesSearch =
        cust.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (cust.phone && cust.phone.includes(searchQuery));

      if (!matchesSearch) return false;
      if (filter === "credit") return cust.total_balance > 0;
      if (filter === "settled") return cust.total_balance <= 0;
      return true;
    });
  }, [customers, searchQuery, filter]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setIsSubmitting(true);
    try {
      await onAddCustomer({
        name: newName.trim(),
        phone: newPhone.trim(),
        opening_balance: parseFloat(newOpeningBal) || 0,
      });
      setNewName("");
      setNewPhone("");
      setNewOpeningBal("");
      setIsModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer || !editName.trim()) return;
    setIsUpdating(true);
    try {
      if (onUpdateCustomer) {
        await onUpdateCustomer(editingCustomer.id, {
          name: editName.trim(),
          phone: editPhone.trim(),
        });
      }
      setEditingCustomer(null);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent, custId: number) => {
    e.stopPropagation();
    if (confirm("Kya aap sach me is grahak ko hatana chahte hain?")) {
      if (onDeleteCustomer) {
        await onDeleteCustomer(custId);
      }
    }
  };

  const getMonogram = (name: string) => {
    const parts = name.trim().split(" ");
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const getAvatarGradient = (id: number) => {
    const gradients = [
      "from-rose-500/20 to-orange-500/20 text-rose-300 border-rose-500/30",
      "from-emerald-500/20 to-teal-500/20 text-emerald-300 border-emerald-500/30",
      "from-indigo-500/20 to-purple-500/20 text-indigo-300 border-indigo-500/30",
      "from-amber-500/20 to-yellow-500/20 text-amber-300 border-amber-500/30",
      "from-cyan-500/20 to-blue-500/20 text-cyan-300 border-cyan-500/30",
    ];
    return gradients[id % gradients.length];
  };

  return (
    <div className="h-full flex flex-col space-y-4 select-none relative">
      {/* Top Search & Action Bar */}
      <div className="flex flex-col gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input
              type="text"
              placeholder="Grahak ya phone khojein..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/[0.03] hover:bg-white/[0.05] focus:bg-white/[0.07] border border-white/[0.08] focus:border-emerald-500/50 text-white placeholder-white/35 text-xs outline-none transition-all"
            />
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="px-3.5 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 hover:from-emerald-500/30 hover:to-teal-500/30 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 transition-all shadow-[0_0_15px_rgba(52,211,153,0.1)] active:scale-95 shrink-0"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>+ Naya Grahak</span>
          </button>
        </div>

        {/* Sliding Segmented Pill Tabs */}
        <div className="flex items-center p-1 rounded-2xl bg-black/40 border border-white/[0.06] relative">
          {(["all", "credit", "settled"] as const).map((tab) => {
            const labels = {
              all: `Sabhi (${customers.length})`,
              credit: `Udhaar (${customers.filter((c) => c.total_balance > 0).length})`,
              settled: `Chukta (${customers.filter((c) => c.total_balance <= 0).length})`,
            };
            const isActive = filter === tab;
            return (
              <button
                key={tab}
                onClick={() => setFilter(tab)}
                className={`relative flex-1 py-1.5 text-xs font-medium rounded-xl transition-colors z-10 ${
                  isActive ? "text-white" : "text-white/40 hover:text-white/70"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeFilterTab"
                    className="absolute inset-0 bg-white/[0.08] border border-white/[0.1] rounded-xl shadow-sm"
                    transition={{ type: "spring", stiffness: 450, damping: 35 }}
                  />
                )}
                <span className="relative z-10">{labels[tab]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Customer Ledger List */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
        <AnimatePresence>
          {filteredCustomers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-white/35">
              <Users className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-xs">Koi grahak nahi mila</p>
            </div>
          ) : (
            filteredCustomers.map((cust) => {
              const isUpdated = cust.id === lastUpdatedCustomerId;
              const isSelected = cust.id === selectedCustomerId;
              const isCredit = cust.total_balance > 0;
              const isAdvance = cust.total_balance < 0;

              return (
                <motion.div
                  key={cust.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  onClick={() => onCustomerSelect && onCustomerSelect(cust)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden ${
                    isSelected
                      ? "bg-white/[0.08] border-emerald-500/40 shadow-[0_0_20px_rgba(52,211,153,0.15)]"
                      : "bg-[#111522]/80 hover:bg-[#151a2b] border-white/[0.08] hover:border-white/20 hover:-translate-y-0.5"
                  } ${isUpdated ? "ring-2 ring-emerald-400/50" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    {/* Left: Avatar + Details */}
                    <div className="flex items-center gap-3">
                      <div
                        className={`h-9 w-9 rounded-xl bg-gradient-to-br ${getAvatarGradient(
                          cust.id
                        )} border flex items-center justify-center font-mono font-bold text-xs shrink-0`}
                      >
                        {getMonogram(cust.name)}
                      </div>

                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-white/90 group-hover:text-white">
                            {cust.name}
                          </span>
                          {cust.is_new && (
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-semibold">
                              NEW
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-white/40 font-mono">
                          {cust.phone || "No phone linked"}
                        </span>
                      </div>
                    </div>

                    {/* Right: Actions, Balance & Status Badge */}
                    <div className="flex items-center gap-3">
                      {/* Hover action icons: Edit & Delete */}
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCustomer(cust);
                            setEditName(cust.name);
                            setEditPhone(cust.phone || "");
                          }}
                          className="h-7 w-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/60 hover:text-white flex items-center justify-center transition-colors"
                          title="Edit Customer"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, cust.id)}
                          className="h-7 w-7 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 text-white/60 hover:text-rose-400 flex items-center justify-center transition-colors"
                          title="Delete Customer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="flex flex-col items-end">
                        <span
                          className={`font-mono font-bold text-sm tabular-nums tracking-tight ${
                            isCredit
                              ? "text-[#FB7185]"
                              : isAdvance
                              ? "text-sky-300"
                              : "text-[#34D399]"
                          }`}
                        >
                          {isCredit
                            ? `₹${cust.total_balance.toLocaleString("en-IN")}`
                            : isAdvance
                            ? `+₹${Math.abs(cust.total_balance).toLocaleString("en-IN")}`
                            : "₹0"}
                        </span>
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-md mt-0.5 ${
                            isCredit
                              ? "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                              : isAdvance
                              ? "bg-sky-500/10 text-sky-300 border border-sky-500/20"
                              : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                          }`}
                        >
                          {isCredit ? "Udhaar Baaki" : isAdvance ? "Advance" : "Chukta"}
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Section: Compact Activity Timeline */}
      <div className="glass-panel p-3.5 shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 flex items-center gap-1.5">
            <Clock className="h-3 w-3 text-emerald-400" />
            Recent Khata Feed
          </span>
          <span className="text-[10px] text-white/30 font-mono">Real-time</span>
        </div>

        <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
          {transactions.slice(0, 4).map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between text-xs py-1 px-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04]"
            >
              <div className="flex items-center gap-2 truncate">
                <span
                  className={`h-4 w-4 rounded-full flex items-center justify-center shrink-0 ${
                    tx.type === "CREDIT"
                      ? "bg-rose-500/20 text-rose-400"
                      : "bg-emerald-500/20 text-emerald-400"
                  }`}
                >
                  {tx.type === "CREDIT" ? (
                    <ArrowUpRight className="h-2.5 w-2.5" />
                  ) : (
                    <ArrowDownLeft className="h-2.5 w-2.5" />
                  )}
                </span>
                <span className="text-white/80 font-medium truncate text-[11px]">
                  {tx.customer_name}
                </span>
                <span className="text-white/35 text-[10px] truncate max-w-[120px]">
                  {tx.notes || "Samaan"}
                </span>
              </div>
              <span
                className={`font-mono tabular-nums text-[11px] font-semibold ${
                  tx.type === "CREDIT" ? "text-rose-400" : "text-emerald-400"
                }`}
              >
                {tx.type === "CREDIT" ? "+" : "-"}₹{tx.amount}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Modal for + Naya Grahak */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="glass-modal w-full max-w-sm p-6 relative overflow-hidden"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <h4 className="text-sm font-bold text-white">Naya Grahak Jodein</h4>
                </div>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="h-6 w-6 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-white/50 hover:text-white flex items-center justify-center transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <form onSubmit={handleCreateCustomer} className="mt-4 space-y-3.5">
                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-white/50 block mb-1">
                    Grahak Ka Naam *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Jaise: Mohan Lal"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white text-xs outline-none focus:border-emerald-400"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-white/50 block mb-1">
                    Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    placeholder="9876543210"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white text-xs outline-none focus:border-emerald-400 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-white/50 block mb-1">
                    Shuruwati Udhaar / Opening Balance (₹)
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={newOpeningBal}
                    onChange={(e) => setNewOpeningBal(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white text-xs outline-none focus:border-emerald-400 font-mono"
                  />
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/60 text-xs font-semibold"
                  >
                    Radd Karein
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 text-xs font-bold shadow-lg shadow-emerald-500/20 active:scale-95"
                  >
                    {isSubmitting ? "Jod Rahe Hain..." : "Khata Banayein"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal for Editing Customer */}
      <AnimatePresence>
        {editingCustomer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="glass-modal w-full max-w-sm p-6 relative overflow-hidden"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Edit2 className="h-4 w-4" />
                  </div>
                  <h4 className="text-sm font-bold text-white">Grahak Details Sudharein</h4>
                </div>
                <button
                  onClick={() => setEditingCustomer(null)}
                  className="h-6 w-6 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-white/50 hover:text-white flex items-center justify-center transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="mt-4 space-y-3.5">
                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-white/50 block mb-1">
                    Grahak Ka Naam
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white text-xs outline-none focus:border-indigo-400"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-white/50 block mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white text-xs outline-none focus:border-indigo-400 font-mono"
                  />
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingCustomer(null)}
                    className="flex-1 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/60 text-xs font-semibold"
                  >
                    Radd Karein
                  </button>
                  <button
                    type="submit"
                    disabled={isUpdating}
                    className="flex-1 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-bold shadow-lg shadow-indigo-500/20 active:scale-95"
                  >
                    {isUpdating ? "Sudhar Rahe Hain..." : "Save Karein"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
