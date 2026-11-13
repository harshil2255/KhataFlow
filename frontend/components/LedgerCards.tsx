"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Search,
  UserPlus,
  Clock,
  X,
  ChevronRight,
  Trash2,
  Edit2,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

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
  const { theme } = useTheme();
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
      return matchesSearch;
    });
  }, [customers, searchQuery]);

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
    <div
      className="h-full rounded-3xl p-4 flex flex-col justify-between select-none relative overflow-hidden"
      style={{
        backgroundColor: `rgba(17, 21, 34, ${theme.glassOpacity})`,
        backdropFilter: `blur(${theme.glassBlur}px)`,
        WebkitBackdropFilter: `blur(${theme.glassBlur}px)`,
        border: "1px solid rgba(255, 255, 255, 0.08)",
        boxShadow: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08), 0 20px 50px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* Header & Search */}
      <div className="flex flex-col gap-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white tracking-tight">Customers</h2>
            <p className="text-[10px] text-white/40">Your Khata Customers</p>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.06] text-white/60 border border-white/10">
            {customers.length} Accounts
          </span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
          <input
            type="text"
            placeholder="Search customers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] focus:border-emerald-500/50 text-white placeholder-white/30 text-xs outline-none transition-all"
          />
        </div>
      </div>

      {/* Customer Directory List */}
      <div className="flex-1 overflow-y-auto space-y-2 my-2.5 pr-1 min-h-0">
        <AnimatePresence>
          {filteredCustomers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 text-center text-white/35">
              <Users className="h-7 w-7 mb-1.5 opacity-50" />
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
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  onClick={() => onCustomerSelect && onCustomerSelect(cust)}
                  className={`p-2.5 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden flex items-center justify-between ${
                    isSelected
                      ? "bg-emerald-500/10 border-emerald-400/50 shadow-[0_0_20px_rgba(52,211,153,0.2)]"
                      : "bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.06] hover:border-white/15"
                  } ${isUpdated ? "ring-2 ring-emerald-400/50" : ""}`}
                >
                  {/* Left: Avatar + Details */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`h-8 w-8 rounded-xl bg-gradient-to-br ${getAvatarGradient(
                        cust.id
                      )} border flex items-center justify-center font-mono font-bold text-xs shrink-0`}
                    >
                      {getMonogram(cust.name)}
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-xs font-semibold text-white/90 group-hover:text-white truncate">
                          {cust.name}
                        </span>
                        {cust.is_new && (
                          <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold shrink-0">
                            NEW
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-white/40 font-mono truncate">
                        Last seen: {cust.created_at ? cust.created_at.split(" ")[0] : "Today"}
                      </span>
                    </div>
                  </div>

                  {/* Right: Balance, Action & Chevron */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Action icons on hover */}
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCustomer(cust);
                          setEditName(cust.name);
                          setEditPhone(cust.phone || "");
                        }}
                        className="h-6 w-6 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/60 hover:text-white flex items-center justify-center transition-colors"
                        title="Edit Customer"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, cust.id)}
                        className="h-6 w-6 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 text-white/60 hover:text-rose-400 flex items-center justify-center transition-colors"
                        title="Delete Customer"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="text-right">
                      <span
                        className={`font-mono font-bold text-xs tabular-nums block ${
                          isCredit ? "text-[#FB7185]" : isAdvance ? "text-sky-300" : "text-[#34D399]"
                        }`}
                      >
                        {isCredit
                          ? `₹${cust.total_balance.toLocaleString("en-IN")}`
                          : isAdvance
                          ? `+₹${Math.abs(cust.total_balance).toLocaleString("en-IN")}`
                          : "₹0"}
                      </span>
                    </div>

                    <ChevronRight className="h-3.5 w-3.5 text-white/30 group-hover:text-white/70 transition-colors" />
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Bottom CTA Button: + Naya Grahak */}
      <div className="pt-2 border-t border-white/[0.06] shrink-0">
        <button
          onClick={() => setIsModalOpen(true)}
          className="w-full py-2.5 rounded-2xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 hover:border-emerald-400/40 text-emerald-300 text-xs font-bold tracking-wide flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-sm"
        >
          <UserPlus className="h-3.5 w-3.5" />
          <span>+ Naya Grahak</span>
        </button>
      </div>

      {/* Modal: Add New Customer */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-sm rounded-3xl p-6 glass-modal space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <h3 className="text-sm font-bold text-white">Naya Grahak Jodein</h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg text-white/50 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleCreateCustomer} className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-white/50 block mb-1">
                    Grahak Ka Naam *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Ramesh Kumar"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white text-xs outline-none focus:border-emerald-400"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-white/50 block mb-1">
                    Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    placeholder="e.g. 9876543210"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white text-xs outline-none focus:border-emerald-400 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-white/50 block mb-1">
                    Opening Udhaar (₹)
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
                    {isSubmitting ? "Jod Rahe Hain..." : "Save Karein"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Edit Customer */}
      <AnimatePresence>
        {editingCustomer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-sm rounded-3xl p-6 glass-modal space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <h3 className="text-sm font-bold text-white">Grahak Details Sudharein</h3>
                <button
                  onClick={() => setEditingCustomer(null)}
                  className="p-1 rounded-lg text-white/50 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="space-y-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-white/50 block mb-1">
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
                  <label className="text-[10px] font-mono uppercase tracking-wider text-white/50 block mb-1">
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
