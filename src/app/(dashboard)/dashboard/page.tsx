import {
  Plus,
  Download,
  ClipboardList,
  AlertTriangle,
  IndianRupee,
  Send,
  Users,
  Scale,
  XCircle,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { getActiveClient } from "@/lib/clientContext";
import { getDashboardData } from "@/lib/dashboardStats";
import { extraPagesEnabled } from "@/lib/featureFlags";
import { traceAsync } from "@/lib/trace";

export default async function Dashboard() {
  return traceAsync("page:/dashboard", "render", async () => {
    const ctx = await getActiveClient();
    if (!ctx) return redirect("/sign-in");
    const { user, client } = ctx;
    const showExtraPages = extraPagesEnabled();


    const { stats, rows } = await getDashboardData(user.id, client.id);

  const {
    invoiceCount,
    draftCount,
    approvedCount,
    exportedCount,
    syncFailedCount,
    syncStuckCount,
    pendingReviewCount,
    unmappedParties,
    gstInput,
    gstOutput,
  } = stats;

  const itcAtStake = stats.itcAtRisk ?? 0;
  const gstLiability = Math.max(0, gstOutput - gstInput);
  const latestRecon =
    stats.reconMatched === null
      ? null
      : {
          matched: stats.reconMatched,
          mismatched: stats.reconMismatched ?? 0,
          itcAtRisk: stats.itcAtRisk ?? 0,
        };

  const reviewList = rows.map((v) => ({
    id: v.id,
    vendor: v.vendor ?? "Unknown",
    invoiceNumber: v.invoiceNumber ?? "—",
    type: v.voucherType,
    amount: v.totalDebit,
    hasUnmapped: v.hasUnmapped,
    confidence: v.avgConfidence,
  }));

    return (
      <div className="p-4 md:p-6 lg:p-7" style={{ maxWidth: "1400px" }}>
      {/* ── Header Row ── */}
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        style={{ marginBottom: "24px" }}
      >
        <div className="min-w-0">
          <h1
            className="font-bold"
            style={{
              fontSize: "clamp(22px, 5vw, 28px)",
              letterSpacing: "0.5px",
              fontFamily: "'Inter', system-ui, sans-serif",
              color: "var(--spx-text)",
            }}
          >
            Dashboard
          </h1>
          <p
            className="truncate"
            style={{ fontSize: "13px", color: "var(--spx-muted)", marginTop: "4px", letterSpacing: "0.3px" }}
          >
            {client.name} · Welcome back, {user.name || "User"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5 sm:shrink-0">
          <a href="/api/export?format=csv" className="flex-1 sm:flex-none">
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              style={{
                borderColor: "var(--spx-border)",
                background: "transparent",
                color: "var(--spx-text)",
                borderRadius: "2px",
                fontSize: "12px",
                letterSpacing: "1px",
                textTransform: "uppercase" as const,
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </a>
          <Link href="/upload" className="flex-1 sm:flex-none">
            <Button
              className="w-full sm:w-auto"
              style={{
                background: "var(--spx-text)",
                color: "var(--spx-canvas)",
                borderRadius: "2px",
                fontSize: "12px",
                letterSpacing: "1px",
                textTransform: "uppercase" as const,
                fontWeight: 700,
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Invoice
            </Button>
          </Link>
        </div>
      </div>

      {/* ── Top Stat Cards: Boxy Grid with Large Numbers ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: "1px", background: "var(--spx-border)", marginBottom: "24px" }}>
        <StatCard
          icon={<ClipboardList style={{ width: "18px", height: "18px" }} strokeWidth={1.5} />}
          label="Pending Review"
          value={pendingReviewCount.toString()}
          href={showExtraPages ? "/review" : "/transactions"}
        />
        <StatCard
          icon={<Scale style={{ width: "18px", height: "18px" }} strokeWidth={1.5} />}
          label="ITC at Stake"
          value={`₹${itcAtStake.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
        />
        <StatCard
          icon={<IndianRupee style={{ width: "18px", height: "18px" }} strokeWidth={1.5} />}
          label="GST Liability"
          value={`₹${gstLiability.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
        />
        <StatCard
          icon={<Users style={{ width: "18px", height: "18px" }} strokeWidth={1.5} />}
          label="Unmapped Parties"
          value={unmappedParties.toString()}
          href="/transactions"
          alert={unmappedParties > 0}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: "1px", background: "var(--spx-border)", marginBottom: "24px" }}>
        <StatCard
          icon={<AlertTriangle style={{ width: "18px", height: "18px" }} strokeWidth={1.5} />}
          label="Draft Vouchers"
          value={draftCount.toString()}
        />
        <StatCard
          icon={<Send style={{ width: "18px", height: "18px" }} strokeWidth={1.5} />}
          label="Ready to Export"
          value={approvedCount.toString()}
          valueColor="#22c55e"
        />
        <StatCard
          icon={<Download style={{ width: "18px", height: "18px" }} strokeWidth={1.5} />}
          label="In Tally"
          value={exportedCount.toString()}
        />
        {/* The number this product exists to keep at zero. Previously it was
            reachable only by opening Transactions and ticking a filter you
            would think to tick only if you already suspected a problem. */}
        <StatCard
          icon={<XCircle style={{ width: "18px", height: "18px" }} strokeWidth={1.5} />}
          label="Rejected by Tally"
          value={syncFailedCount.toString()}
          href="/transactions?sync=failed"
          alert={syncFailedCount > 0}
          valueColor={syncFailedCount > 0 ? "#ef4444" : undefined}
        />
      </div>

      {/* Two columns, not four: the container paints the 1px gap colour, so a
          half-filled four-column row renders the empty cells as a grey slab. */}
      <div
        className="grid grid-cols-2"
        style={{ gap: "1px", background: "var(--spx-border)", marginBottom: "24px" }}
      >
        {/* Stuck is not the same as failed and is worth its own number: it
            means a connector took the job and never reported back, so the
            voucher may already be in the client's books. It is also the state
            that strands a voucher for good if the row is deleted while it
            sits there. */}
        <StatCard
          icon={<Clock style={{ width: "18px", height: "18px" }} strokeWidth={1.5} />}
          label="Stuck Sending"
          value={syncStuckCount.toString()}
          href="/transactions?sync=stuck"
          alert={syncStuckCount > 0}
          valueColor={syncStuckCount > 0 ? "#f59e0b" : undefined}
        />
        <StatCard
          icon={<ClipboardList style={{ width: "18px", height: "18px" }} strokeWidth={1.5} />}
          label="Invoices"
          value={invoiceCount.toString()}
        />
      </div>

      {/* ── Main Grid: Table + Quick Actions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px]" style={{ gap: "24px" }}>
        {/* Vouchers Table */}
        <div style={{ border: "1px solid var(--spx-border)", background: "var(--spx-card)" }}>
          {/* Table Header Bar */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 20px",
              borderBottom: "1px solid var(--spx-border)",
            }}
          >
            <span
              className="uppercase"
              style={{ fontSize: "11px", letterSpacing: "1.5px", fontWeight: 500, color: "var(--spx-muted)" }}
            >
              Vouchers to Review
            </span>
            <Link
              href={showExtraPages ? "/review" : "/transactions"}
              style={{
                fontSize: "11px",
                letterSpacing: "1.2px",
                textTransform: "uppercase" as const,
                color: "var(--spx-text)",
                border: "1px solid var(--spx-border)",
                padding: "5px 14px",
                fontWeight: 500,
              }}
            >
              View All
            </Link>
          </div>

          {/* Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--spx-border)" }}>
                  {["Vendor", "Invoice #", "Type", "Amount", "Status"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "12px 16px",
                        fontSize: "11px",
                        fontWeight: 400,
                        color: "var(--spx-muted)",
                        textTransform: "uppercase" as const,
                        letterSpacing: "1.5px",
                        textAlign: h === "Amount" ? "right" : "left",
                        fontFamily: "'Inter', system-ui, sans-serif",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reviewList.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ padding: "48px 16px", textAlign: "center", color: "var(--spx-muted)", fontSize: "13px" }}
                    >
                      No drafts pending. Upload an invoice to generate a voucher.
                    </td>
                  </tr>
                )}
                {reviewList.map((v) => (
                  <tr
                    key={v.id}
                    style={{ borderBottom: "1px solid var(--spx-border-subtle)" }}
                  >
                    <td style={{ padding: "14px 16px" }}>
                      <Link
                        href={`/vouchers/${v.id}`}
                        className="hover:underline"
                        style={{ fontSize: "14px", fontWeight: 500, color: "var(--spx-text)" }}
                      >
                        {v.vendor}
                      </Link>
                    </td>
                    <td
                      style={{
                        padding: "14px 16px",
                        color: "var(--spx-text-secondary)",
                        fontSize: "13px",
                        fontFamily: "'Geist Mono', 'Courier New', monospace",
                      }}
                    >
                      {v.invoiceNumber}
                    </td>
                    <td style={{ padding: "14px 16px", color: "var(--spx-text-secondary)", fontSize: "13px" }}>
                      {v.type}
                    </td>
                    <td
                      style={{
                        padding: "14px 16px",
                        textAlign: "right",
                        fontWeight: 600,
                        color: "var(--spx-text)",
                        fontSize: "14px",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      ₹{v.amount.toLocaleString("en-IN")}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      {v.hasUnmapped ? (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            fontSize: "10px",
                            fontWeight: 700,
                            letterSpacing: "1px",
                            textTransform: "uppercase" as const,
                            border: "1px solid rgba(239, 68, 68, 0.5)",
                            color: "#f87171",
                          }}
                        >
                          Needs ledger
                        </span>
                      ) : (v.confidence ?? 1) < 0.7 ? (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            fontSize: "10px",
                            fontWeight: 700,
                            letterSpacing: "1px",
                            textTransform: "uppercase" as const,
                            border: "1px solid rgba(245, 158, 11, 0.5)",
                            color: "#fbbf24",
                          }}
                        >
                          Low confidence
                        </span>
                      ) : (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            fontSize: "10px",
                            fontWeight: 700,
                            letterSpacing: "1px",
                            textTransform: "uppercase" as const,
                            border: "1px solid rgba(34, 197, 94, 0.5)",
                            color: "#4ade80",
                          }}
                        >
                          Ready
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Right Column: Quick Actions ── */}
        <div style={{ border: "1px solid var(--spx-border)", background: "var(--spx-card)" }}>
          <div
            style={{
              padding: "14px 20px",
              borderBottom: "1px solid var(--spx-border)",
            }}
          >
            <span
              className="uppercase"
              style={{ fontSize: "11px", letterSpacing: "1.5px", fontWeight: 500, color: "var(--spx-muted)" }}
            >
              Quick Actions
            </span>
          </div>
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
            {showExtraPages && (
              <Link
                href="/gst"
                style={{
                  display: "block",
                  border: "1px solid var(--spx-border)",
                  padding: "12px 14px",
                  fontSize: "13px",
                  color: "var(--spx-text-secondary)",
                }}
              >
                Run GST reconciliation (GSTR-2B)
              </Link>
            )}
            {showExtraPages && (
              <Link
                href="/pipeline"
                style={{
                  display: "block",
                  border: "1px solid var(--spx-border)",
                  padding: "12px 14px",
                  fontSize: "13px",
                  color: "var(--spx-text-secondary)",
                }}
              >
                View pipeline board
              </Link>
            )}
            {showExtraPages && (
              <Link
                href="/reports"
                style={{
                  display: "block",
                  border: "1px solid var(--spx-border)",
                  padding: "12px 14px",
                  fontSize: "13px",
                  color: "var(--spx-text-secondary)",
                }}
              >
                GST summary &amp; reports
              </Link>
            )}
            <Link
              href="/transactions"
              className="hover:bg-emerald-500/[0.08] transition"
              style={{
                display: "block",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                background: "rgba(34, 197, 94, 0.04)",
                padding: "12px 14px",
                fontSize: "13px",
                color: "#4ade80",
                fontWeight: 500,
              }}
            >
              Export approved vouchers to Tally XML
            </Link>
            {showExtraPages && latestRecon && (
              <div
                style={{
                  border: "1px solid rgba(245, 158, 11, 0.3)",
                  background: "rgba(245, 158, 11, 0.04)",
                  padding: "12px 14px",
                  fontSize: "13px",
                }}
              >
                <div style={{ fontWeight: 500, color: "#fbbf24" }}>Latest 2B recon</div>
                <div style={{ color: "rgba(251, 191, 36, 0.6)", marginTop: "4px", fontSize: "12px" }}>
                  {latestRecon.matched} matched · {latestRecon.mismatched} mismatch · ITC at risk ₹
                  {latestRecon.itcAtRisk.toLocaleString("en-IN")}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    );
  });
}

/* ── StatCard: Boxy, sharp corners, large number, matching reference exactly ── */
function StatCard({
  icon,
  label,
  value,
  valueColor,
  href,
  alert = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bg?: string;
  valueColor?: string;
  href?: string;
  alert?: boolean;
}) {
  const card = (
    <div
      className="min-w-0 transition"
      style={{
        padding: "16px 18px",
        background: alert ? "rgba(229, 62, 62, 0.04)" : "var(--spx-card)",
        borderRight: alert ? "2px solid rgba(229, 62, 62, 0.5)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px", gap: "8px" }}>
        <span
          className="truncate"
          style={{
            fontSize: "11px",
            fontWeight: 500,
            color: "var(--spx-muted)",
            textTransform: "uppercase" as const,
            letterSpacing: "1.5px",
            fontFamily: "'Inter', system-ui, sans-serif",
          }}
        >
          {label}
        </span>
        <span className="shrink-0" style={{ color: "var(--spx-icon-dim)" }}>{icon}</span>
      </div>
      <p
        className="truncate"
        style={{
          fontSize: "clamp(20px, 4.5vw, 42px)",
          fontWeight: 700,
          color: valueColor || "var(--spx-text)",
          lineHeight: 1,
          fontFamily: "'Inter', system-ui, sans-serif",
          letterSpacing: "-0.5px",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
    </div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}
