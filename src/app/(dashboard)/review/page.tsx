import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { redirect } from "next/navigation";
import ReviewQueue from "./ReviewQueue";

export default async function ReviewPage() {
  const ctx = await getActiveClient();
  if (!ctx) redirect("/sign-in");
  const { user, client } = ctx;

  const drafts = await prisma.voucher.findMany({
    where: { userId: user.id, clientId: client.id, status: "DRAFT" },
    orderBy: [{ avgConfidence: "asc" }, { createdAt: "desc" }],
    include: {
      invoice: {
        select: {
          vendor: true,
          invoiceNumber: true,
          isDuplicate: true,
          totalAmount: true,
          validationFlags: true,
        },
      },
      lines: { select: { ledgerId: true, confidence: true } },
    },
  });

  const rows = drafts.map((v) => {
    const hasUnmapped = v.lines.some((l) => l.ledgerId === null);
    const conf = v.avgConfidence ?? null;
    const issues = Array.isArray(v.invoice?.validationFlags)
      ? (v.invoice!.validationFlags as any[]).length
      : 0;
    let priority: "critical" | "low" | "ready" | "high" = "ready";
    if (hasUnmapped || (conf != null && conf < 0.7) || v.invoice?.isDuplicate || issues > 0) {
      priority = hasUnmapped || (conf != null && conf < 0.5) ? "critical" : "low";
    } else if (conf != null && conf >= 0.9 && !hasUnmapped) {
      priority = "high";
    }

    return {
      id: v.id,
      vendor: v.invoice?.vendor || "Unknown",
      invoiceNumber: v.invoice?.invoiceNumber || "—",
      amount: v.invoice?.totalAmount ?? v.totalDebit,
      confidence: conf,
      hasUnmapped,
      isDuplicate: v.invoice?.isDuplicate ?? false,
      issueCount: issues,
      balanced: Math.abs(v.totalDebit - v.totalCredit) < 0.01,
      priority,
      voucherType: v.voucherType,
    };
  });

  const highReady = rows.filter(
    (r) => r.priority === "high" && r.balanced && !r.hasUnmapped
  ).length;

  return (
    <ReviewQueue
      rows={rows}
      highReadyCount={highReady}
    />
  );
}
