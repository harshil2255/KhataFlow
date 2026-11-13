"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Mail,
  Send,
  Printer,
  Copy,
  Check,
  Building2,
  Calendar,
  ExternalLink,
  Receipt,
  FileCheck,
  FileDown,
  Loader2,
} from "lucide-react";
import { Customer } from "./LedgerCards";
import { LineItem } from "./LiveVisualizer";

interface InvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: Customer | null;
  items: LineItem[];
  grandTotal: number;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({
  isOpen,
  onClose,
  customer,
  items,
  grandTotal,
}) => {
  const [mounted, setMounted] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");

  useEffect(() => {
    setMounted(true);
  }, []);
  const [copied, setCopied] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [shopName, setShopName] = useState("KhataFlow Kirana Store");
  const [notes, setNotes] = useState("Thank you for your business! Kripya samay par hisaab chukta karein.");
  const [paymentBreakdown, setPaymentBreakdown] = useState<{
    totalBilled: number;
    totalPaid: number;
    balanceDue: number;
  }>({
    totalBilled: grandTotal,
    totalPaid: 0,
    balanceDue: grandTotal,
  });

  useEffect(() => {
    if (customer?.id) {
      fetch(`http://localhost:8000/api/customers/${customer.id}/bill`)
        .then((res) => res.json())
        .then((data) => {
          if (data && typeof data.total_billed === "number") {
            setPaymentBreakdown({
              totalBilled: data.total_billed,
              totalPaid: data.total_paid ?? 0,
              balanceDue: data.balance_due ?? customer.total_balance,
            });
          } else {
            const paid = customer.total_balance < grandTotal ? Math.max(0, grandTotal - customer.total_balance) : 0;
            setPaymentBreakdown({
              totalBilled: grandTotal,
              totalPaid: paid,
              balanceDue: customer.total_balance,
            });
          }
        })
        .catch(() => {
          setPaymentBreakdown({
            totalBilled: grandTotal,
            totalPaid: 0,
            balanceDue: customer.total_balance,
          });
        });
    }
  }, [customer?.id, grandTotal]);

  const [invoiceDates, setInvoiceDates] = useState({
    invoiceNumber: "",
    invoiceDate: "",
    dueDate: "",
  });

  React.useEffect(() => {
    if (customer) {
      const now = new Date();
      const num = `KF-INV-${customer.id}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
        now.getDate()
      ).padStart(2, "0")}`;
      const invDate = now.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const due = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      setInvoiceDates({
        invoiceNumber: num,
        invoiceDate: invDate,
        dueDate: due,
      });
    }
  }, [customer]);

  if (!isOpen || !customer) return null;

  const formatInr = (val: number | null | undefined): string => {
    if (val === null || val === undefined || isNaN(val)) return "0";
    const rounded = Math.round((val + Number.EPSILON) * 100) / 100;
    return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(2);
  };

  const { invoiceNumber, invoiceDate, dueDate } = invoiceDates;

  const generateEmailText = () => {
    let text = `Namaste ${customer.name} ji,\n\n`;
    text += `Aapka ${shopName} ka Invoice (${invoiceNumber}) ready hai.\n\n`;
    text += `--------------------------------------------------------\n`;
    text += `DATE: ${invoiceDate}\n`;
    text += `DUE DATE: ${dueDate}\n`;
    text += `--------------------------------------------------------\n`;
    text += `PURCHASED ITEMS:\n`;

    items.forEach((it, idx) => {
      text += `${idx + 1}. ${it.name} - ${it.qty} ${it.unit || "pkt"} x ₹${formatInr(it.unit_price)} = ₹${formatInr(it.total)}\n`;
    });

    text += `--------------------------------------------------------\n`;
    text += `TOTAL BILLED: ₹${formatInr(paymentBreakdown.totalBilled)}\n`;
    text += `AMOUNT PAID (JAMA KIYA): ₹${formatInr(paymentBreakdown.totalPaid)}\n`;
    text += `NET BALANCE DUE (BAAKI DENA HAI): ₹${formatInr(paymentBreakdown.balanceDue)}\n\n`;
    if (notes) {
      text += `NOTE: ${notes}\n\n`;
    }
    text += `Thank you for shopping with us!\n~ ${shopName} (Dukaan ka Smart Saathi)\n`;
    return text;
  };

  const handleOpenGmail = async () => {
    setGeneratingPdf(true);
    const subjectEncoded = encodeURIComponent(`Invoice ${invoiceNumber} from ${shopName} - ₹${formatInr(grandTotal)}`);
    const bodyEncoded = encodeURIComponent(generateEmailText());
    const targetEmail = recipientEmail.trim();

    // 1. Generate & download the exact PDF file using html2pdf.js (consistent with invoiceman)
    try {
      const element = document.getElementById("invoice-document-khataflow");
      if (element) {
        const html2pdf = (await import("html2pdf.js")).default;
        const opt = {
          margin: 0.3,
          filename: `${invoiceNumber}.pdf`,
          image: { type: "jpeg" as const, quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: "in", format: "letter", orientation: "portrait" as const },
        };
        await html2pdf().set(opt).from(element).save();
      }
    } catch (e) {
      console.error("PDF generation error:", e);
    } finally {
      setGeneratingPdf(false);
    }

    // 2. Open Gmail compose with pre-filled body, recipient, and invoice details
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
      targetEmail
    )}&su=${subjectEncoded}&body=${bodyEncoded}`;

    window.open(gmailUrl, "_blank", "noopener,noreferrer");
  };

  const handleOpenMailto = () => {
    const subjectEncoded = encodeURIComponent(`Invoice ${invoiceNumber} from ${shopName} - ₹${formatInr(grandTotal)}`);
    const bodyEncoded = encodeURIComponent(generateEmailText());
    const targetEmail = recipientEmail.trim();
    window.location.href = `mailto:${targetEmail}?subject=${subjectEncoded}&body=${bodyEncoded}`;
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(generateEmailText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      console.error("Failed to copy", e);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen || !customer || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-8 bg-black/85 backdrop-blur-2xl overflow-y-auto">
      <motion.div
        key={`invoice-modal-${customer.id}`}
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-4xl max-h-[86vh] my-auto flex flex-col rounded-3xl bg-[#0d111c] border border-white/20 shadow-[0_30px_90px_rgba(0,0,0,0.95)] overflow-hidden text-white"
      >
        {/* Header Controls (no-print) */}
          <div className="no-print p-4 sm:px-6 flex items-center justify-between border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-bold shadow-lg shadow-emerald-500/20">
                <Receipt className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                  Invoice Generator & Gmail Dispatch
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Spatial Kirana
                  </span>
                </h2>
                <p className="text-[11px] text-white/50">
                  Direct 1-click Gmail redirect with full itemized breakdown
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white/60 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Action Ribbon: Email input & Quick Send Buttons (no-print) */}
          <div className="no-print p-4 sm:px-6 bg-white/[0.015] border-b border-white/[0.06] flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-2 flex-1 min-w-[280px]">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                <input
                  type="email"
                  placeholder="Grahak ka Email (e.g. customer@gmail.com)..."
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-emerald-400 font-mono"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Direct Gmail Redirect Button */}
              <button
                onClick={handleOpenGmail}
                disabled={generatingPdf}
                className="px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-lg shadow-emerald-500/25 active:scale-95 transition-all disabled:opacity-60"
                title="Generates invoice PDF and opens Gmail compose with complete itemized bill"
              >
                {generatingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                <span>{generatingPdf ? "Attaching PDF..." : "Send via Gmail"}</span>
                <ExternalLink className="h-3 w-3 opacity-70" />
              </button>

              {/* Default Mail App Link */}
              <button
                onClick={handleOpenMailto}
                className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white/80 border border-white/10 transition-colors"
                title="Open system default email client"
              >
                <Mail className="h-3.5 w-3.5 text-cyan-400" /> Default Mail
              </button>

              {/* Copy Plaintext Summary */}
              <button
                onClick={handleCopyText}
                className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white/80 border border-white/10 transition-colors"
                title="Copy bill text for WhatsApp or SMS"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied!" : "Copy Bill"}
              </button>

              {/* Print / Save as PDF */}
              <button
                onClick={handlePrint}
                className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-white/[0.06] hover:bg-white/[0.1] text-white/80 border border-white/10 transition-colors"
                title="Print clean invoice or Save as PDF"
              >
                <Printer className="h-3.5 w-3.5 text-purple-400" /> Print / PDF
              </button>
            </div>
          </div>

          {/* Printable Invoice Document Body */}
          <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6">
            <div
              id="invoice-document-khataflow"
              style={{
                backgroundColor: "#ffffff",
                color: "#0f172a",
                borderRadius: "1rem",
                padding: "2rem",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
                border: "1px solid #e2e8f0",
              }}
            >
              {/* Header with Shop & Customer details */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  paddingBottom: "1.5rem",
                  borderBottom: "2px solid #e2e8f0",
                  gap: "1rem",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "1.5rem", fontWeight: 900, letterSpacing: "-0.025em", color: "#0f172a" }}>
                      {shopName}
                    </span>
                  </div>
                  <p style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 500, marginTop: "0.25rem" }}>
                    Dukaan ka Smart Saathi • Digital Kirana Ledger
                  </p>
                  <p style={{ fontSize: "0.75rem", color: "#94a3b8", fontFamily: "monospace", marginTop: "0.125rem" }}>
                    GSTIN: 23AAAAA0000A1Z5 (Unregistered / Composition)
                  </p>
                </div>

                <div style={{ textAlign: "right" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.25rem 0.75rem",
                      borderRadius: "9999px",
                      backgroundColor: "#ecfdf5",
                      color: "#047857",
                      fontSize: "0.75rem",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: "0.5rem",
                      border: "1px solid #a7f3d0",
                    }}
                  >
                    INVOICE
                  </span>
                  <div style={{ fontSize: "0.75rem", color: "#64748b", fontFamily: "monospace" }}>{invoiceNumber}</div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "#334155", marginTop: "0.25rem" }}>
                    Date: {invoiceDate}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Due: {dueDate}</div>
                </div>
              </div>

              {/* Bill To & Ledger Status */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "1rem",
                  paddingTop: "1.5rem",
                  paddingBottom: "1.5rem",
                  borderBottom: "1px solid #e2e8f0",
                }}
              >
                <div>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "#94a3b8",
                      display: "block",
                      marginBottom: "0.25rem",
                    }}
                  >
                    Billed To (Grahak):
                  </span>
                  <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#0f172a", margin: 0 }}>{customer.name}</h3>
                  <p style={{ fontSize: "0.75rem", color: "#475569", fontFamily: "monospace", margin: "0.25rem 0" }}>
                    Phone: {customer.phone || "No phone linked"}
                  </p>
                  <p style={{ fontSize: "0.75rem", color: "#64748b", margin: 0 }}>
                    Account Status:{" "}
                    <span
                      style={{
                        fontWeight: 600,
                        color:
                          customer.total_balance > 0
                            ? "#e11d48"
                            : customer.total_balance < 0
                            ? "#0284c7"
                            : "#059669",
                      }}
                    >
                      {customer.total_balance > 0
                        ? `Udhaar Baaki (₹${formatInr(customer.total_balance)})`
                        : customer.total_balance < 0
                        ? `Advance Jama (+₹${formatInr(Math.abs(customer.total_balance))})`
                        : "Khata Chukta (₹0)"}
                    </span>
                  </p>
                </div>

                <div style={{ textAlign: "right", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "#94a3b8",
                      display: "block",
                      marginBottom: "0.25rem",
                    }}
                  >
                    Payment Terms:
                  </span>
                  <p style={{ fontSize: "0.75rem", color: "#334155", fontWeight: 500, margin: 0 }}>Kirana Credit Account</p>
                  <p style={{ fontSize: "0.75rem", color: "#64748b", margin: "0.25rem 0 0 0" }}>Net 7 Days / Spoken Udhaar</p>
                </div>
              </div>

              {/* Items Table */}
              <div style={{ paddingTop: "1.5rem", paddingBottom: "1.5rem" }}>
                <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
                  <thead>
                    <tr
                      style={{
                        borderBottom: "2px solid #cbd5e1",
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#475569",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      <th style={{ padding: "0.625rem 0" }}>#</th>
                      <th style={{ padding: "0.625rem 0" }}>Item Description</th>
                      <th style={{ padding: "0.625rem 0", textAlign: "center" }}>Qty</th>
                      <th style={{ padding: "0.625rem 0", textAlign: "right" }}>Rate (₹)</th>
                      <th style={{ padding: "0.625rem 0", textAlign: "right" }}>Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody style={{ fontSize: "0.75rem" }}>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={5} style={{ padding: "1.5rem 0", textAlign: "center", color: "#94a3b8", fontStyle: "italic" }}>
                          No items listed on this bill.
                        </td>
                      </tr>
                    ) : (
                      items.map((it, idx) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "0.75rem 0", color: "#94a3b8", fontFamily: "monospace" }}>{idx + 1}</td>
                          <td style={{ padding: "0.75rem 0", fontWeight: 600, color: "#1e293b" }}>{it.name}</td>
                          <td style={{ padding: "0.75rem 0", textAlign: "center", color: "#475569", fontFamily: "monospace" }}>
                            {it.qty} {it.unit || "pkt"}
                          </td>
                          <td style={{ padding: "0.75rem 0", textAlign: "right", color: "#475569", fontFamily: "monospace" }}>
                            ₹{formatInr(it.unit_price)}
                          </td>
                          <td style={{ padding: "0.75rem 0", textAlign: "right", fontWeight: 700, color: "#0f172a", fontFamily: "monospace" }}>
                            ₹{formatInr(it.total)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Totals & Notes */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  paddingTop: "1rem",
                  borderTop: "2px solid #e2e8f0",
                  gap: "1rem",
                }}
              >
                <div style={{ maxWidth: "28rem" }}>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: "#94a3b8",
                      display: "block",
                      marginBottom: "0.25rem",
                    }}
                  >
                    Store Note & Instructions:
                  </span>
                  <p style={{ fontSize: "0.75rem", color: "#475569", lineHeight: 1.6, fontStyle: "italic", margin: 0 }}>
                    {notes}
                  </p>
                </div>

                <div style={{ width: "17rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#475569", marginBottom: "0.4rem" }}>
                    <span>Total Billed:</span>
                    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>₹{formatInr(paymentBreakdown.totalBilled)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#059669", marginBottom: "0.4rem" }}>
                    <span>Amount Paid (Diya):</span>
                    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>-₹{formatInr(paymentBreakdown.totalPaid)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#64748b", marginBottom: "0.4rem" }}>
                    <span>Kirana Tax (0% Exempt):</span>
                    <span style={{ fontFamily: "monospace" }}>₹0.00</span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingTop: "0.5rem",
                      borderTop: "2px solid #cbd5e1",
                      marginTop: "0.25rem",
                    }}
                  >
                    <span style={{ fontSize: "0.875rem", fontWeight: 800, color: "#0f172a" }}>Balance Due (Baaki):</span>
                    <span
                      style={{
                        fontSize: "1.25rem",
                        fontWeight: 900,
                        color: paymentBreakdown.balanceDue > 0 ? "#e11d48" : "#059669",
                        fontFamily: "monospace",
                      }}
                    >
                      ₹{formatInr(paymentBreakdown.balanceDue)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div
                style={{
                  marginTop: "2rem",
                  paddingTop: "1rem",
                  borderTop: "1px solid #f1f5f9",
                  textAlign: "center",
                  fontSize: "10px",
                  color: "#94a3b8",
                  fontFamily: "monospace",
                }}
              >
                Computer-generated invoice via KhataFlow Voice AI Engine. No signature required.
              </div>
            </div>
          </div>
        </motion.div>
      </div>,
      document.body
  );
};
