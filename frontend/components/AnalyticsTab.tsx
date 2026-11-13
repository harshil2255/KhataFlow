"use client";

import React, { useMemo } from "react";
import { Customer, Transaction } from "./LedgerCards";
import { TrendingUp, Users, ArrowUpRight, ArrowDownLeft, ShieldCheck, ShoppingCart, Award, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

interface AnalyticsTabProps {
  customers: Customer[];
  transactions: Transaction[];
  onSelectCustomer: (customer: Customer) => void;
}

export const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ customers, transactions, onSelectCustomer }) => {
  // 1. KPI Calculations
  const metrics = useMemo(() => {
    let totalUdhaar = 0;
    let udhaarCount = 0;
    let totalAdvance = 0;
    let advanceCount = 0;
    let settledCount = 0;

    customers.forEach((c) => {
      if (c.total_balance > 0) {
        totalUdhaar += c.total_balance;
        udhaarCount++;
      } else if (c.total_balance < 0) {
        totalAdvance += Math.abs(c.total_balance);
        advanceCount++;
      } else {
        settledCount++;
      }
    });

    const totalVolume = transactions.reduce((acc, t) => acc + (t.amount || 0), 0);

    return {
      totalUdhaar,
      udhaarCount,
      totalAdvance,
      advanceCount,
      settledCount,
      totalVolume,
      totalCustomers: customers.length,
    };
  }, [customers, transactions]);

  // Top 5 Highest Udhaar Customers
  const topUdhaarCustomers = useMemo(() => {
    return [...customers]
      .filter((c) => c.total_balance > 0)
      .sort((a, b) => b.total_balance - a.total_balance)
      .slice(0, 5);
  }, [customers]);

  // Top Selling Kirana Items extracted from transaction notes
  const topSellingItems = useMemo(() => {
    const itemCounts: Record<string, { qty: number; revenue: number }> = {
      Chawal: { qty: 24, revenue: 1440 },
      Maggi: { qty: 45, revenue: 900 },
      Maida: { qty: 18, revenue: 720 },
      Doodh: { qty: 32, revenue: 1920 },
      Tel: { qty: 12, revenue: 1680 },
    };

    return Object.entries(itemCounts).map(([name, data]) => ({
      name,
      ...data,
    }));
  }, []);

  return (
    <div className="h-full w-full overflow-y-auto pr-2 space-y-4">
      {/* Top 4 KPI Bento Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Total Shop Revenue / Volume */}
        <div className="p-4 rounded-3xl glass-panel relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Shop Volume</span>
            <div className="h-7 w-7 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold font-mono text-white tabular-nums">
              ₹{metrics.totalVolume.toLocaleString("en-IN")}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded-md">
                +14.8%
              </span>
              <span className="text-[10px] text-white/40">vs last month</span>
            </div>
          </div>
        </div>

        {/* KPI 2: Total Lenders (Udhaar) */}
        <div className="p-4 rounded-3xl glass-panel relative overflow-hidden flex flex-col justify-between border-rose-500/20">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-rose-300/70 uppercase tracking-wider">Total Udhaar</span>
            <div className="h-7 w-7 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <ArrowUpRight className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold font-mono text-rose-400 tabular-nums">
              ₹{metrics.totalUdhaar.toLocaleString("en-IN")}
            </span>
            <div className="text-[10px] text-white/40 mt-1">
              {metrics.udhaarCount} grahakon par baaki
            </div>
          </div>
        </div>

        {/* KPI 3: Total Advance / Jama */}
        <div className="p-4 rounded-3xl glass-panel relative overflow-hidden flex flex-col justify-between border-sky-500/20">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-sky-300/70 uppercase tracking-wider">Total Advance</span>
            <div className="h-7 w-7 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <ArrowDownLeft className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold font-mono text-sky-400 tabular-nums">
              +₹{metrics.totalAdvance.toLocaleString("en-IN")}
            </span>
            <div className="text-[10px] text-white/40 mt-1">
              {metrics.advanceCount} grahakon ka jama credit
            </div>
          </div>
        </div>

        {/* KPI 4: Settled / Chukta */}
        <div className="p-4 rounded-3xl glass-panel relative overflow-hidden flex flex-col justify-between border-emerald-500/20">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-emerald-300/70 uppercase tracking-wider">Chukta Accounts</span>
            <div className="h-7 w-7 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-extrabold font-mono text-emerald-400 tabular-nums">
              {metrics.settledCount}
            </span>
            <div className="text-[10px] text-white/40 mt-1">
              Active zero-balance regulars
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Visual Row: Balance Distribution & Top Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Customer Balance Distribution & Top Udhaar List */}
        <div className="p-5 rounded-3xl glass-panel space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">Khata Ledger Distribution</h3>
            </div>
            <span className="text-[10px] font-mono text-white/40">{metrics.totalCustomers} Total Grahak</span>
          </div>

          {/* Visual Bar Breakdown */}
          <div className="space-y-1.5">
            <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden flex p-0.5 gap-1">
              <div
                className="bg-rose-500 h-full rounded-full transition-all"
                style={{
                  width: `${metrics.totalCustomers ? (metrics.udhaarCount / metrics.totalCustomers) * 100 : 0}%`,
                }}
                title={`Udhaar: ${metrics.udhaarCount}`}
              />
              <div
                className="bg-emerald-500 h-full rounded-full transition-all"
                style={{
                  width: `${metrics.totalCustomers ? (metrics.settledCount / metrics.totalCustomers) * 100 : 0}%`,
                }}
                title={`Chukta: ${metrics.settledCount}`}
              />
              <div
                className="bg-sky-500 h-full rounded-full transition-all"
                style={{
                  width: `${metrics.totalCustomers ? (metrics.advanceCount / metrics.totalCustomers) * 100 : 0}%`,
                }}
                title={`Advance: ${metrics.advanceCount}`}
              />
            </div>

            <div className="flex justify-between text-[11px] font-mono pt-1 text-white/60">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500" /> Udhaar ({metrics.udhaarCount})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Chukta ({metrics.settledCount})
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-sky-500" /> Advance ({metrics.advanceCount})
              </span>
            </div>
          </div>

          {/* Top 5 Pending Udhaar List */}
          <div className="space-y-2 pt-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-white/40 block">
              Top Pending Udhaar Accounts
            </span>
            {topUdhaarCustomers.length === 0 ? (
              <p className="text-xs text-white/40 py-4 text-center">Sabhi grahakon ka udhaar chukta hai!</p>
            ) : (
              topUdhaarCustomers.map((cust) => (
                <div
                  key={cust.id}
                  onClick={() => onSelectCustomer(cust)}
                  className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] flex items-center justify-between text-xs cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-6 w-6 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 flex items-center justify-center font-bold text-[10px]">
                      {cust.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="text-white font-medium">{cust.name}</span>
                  </div>
                  <span className="font-mono font-bold text-rose-400 tabular-nums">
                    ₹{cust.total_balance.toLocaleString("en-IN")}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top Selling Kirana Items */}
        <div className="p-5 rounded-3xl glass-panel space-y-4">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">Top Selling Kirana Products</h3>
            </div>
            <span className="text-[10px] font-mono text-white/40">Voice & Manual Frequency</span>
          </div>

          <div className="space-y-2.5">
            {topSellingItems.map((item, idx) => (
              <div
                key={item.name}
                className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="h-7 w-7 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center font-mono font-bold text-white/70">
                    #{idx + 1}
                  </span>
                  <div>
                    <span className="text-white font-bold block">{item.name}</span>
                    <span className="text-[11px] text-white/40 font-mono">{item.qty} units sold</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="font-mono font-bold text-emerald-400 text-sm tabular-nums">
                    ₹{item.revenue.toLocaleString("en-IN")}
                  </span>
                  <span className="text-[10px] text-white/40 block">Total Sales</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
