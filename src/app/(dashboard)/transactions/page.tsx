import { redirect } from "next/navigation";
import { getActiveClient } from "@/lib/clientContext";
import { prisma } from "@/lib/prisma";
import TransactionsList from "./TransactionsList";
import { traceAsync } from "@/lib/trace";

/**
 * `?sync=failed` opens straight into the failed-push list.
 *
 * Read here rather than with `useSearchParams` in the client component: this
 * page is already an async server component, so threading it down as a prop
 * avoids pulling the whole table behind a Suspense boundary for one boolean.
 */
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ sync?: string }>;
}) {
  const { sync } = await searchParams;
  return traceAsync("page:/transactions", "render", async () => {
    const ctx = await getActiveClient();
    if (!ctx) return redirect("/sign-in");
    const { user, client } = ctx;

    const scope = { userId: user.id, clientId: client.id };

    const [vouchers, statements] = await Promise.all([
      traceAsync(
        "page:/transactions",
        "query-vouchers",
        () =>
          prisma.voucher.findMany({
            where: scope,
            orderBy: { createdAt: "desc" },
            // select, not include: include ships every scalar column on Voucher when
            // the table below only renders six of them.
            select: {
              id: true,
              voucherType: true,
              totalDebit: true,
              status: true,
              avgConfidence: true,
              invoice: { select: { vendor: true, invoiceNumber: true, isDuplicate: true } },
              lines: { select: { ledgerId: true } },
            },
          }),
        { userId: user.id, clientId: client.id }
      ),
      traceAsync(
        "page:/transactions",
        "query-statements",
        () =>
          prisma.bankStatement.findMany({
            where: scope,
            orderBy: { createdAt: "desc" },
            select: { id: true, fileName: true, bankName: true, status: true },
          }),
        { userId: user.id, clientId: client.id }
      ),
    ]);

  // Roll the per-statement totals up in Postgres instead of streaming every
  // BankTxn row over the wire just to count and sum them.
    const statementIds = statements.map((s) => s.id);
    const [txnTotals, txnUnmapped] = statementIds.length
      ? await Promise.all([
          traceAsync(
            "page:/transactions",
            "groupby-txn-totals",
            () =>
              prisma.bankTxn.groupBy({
                by: ["statementId"],
                where: { statementId: { in: statementIds } },
                _count: { _all: true },
                _sum: { deposit: true, withdrawal: true },
              }),
            { statementCount: statementIds.length }
          ),
          traceAsync(
            "page:/transactions",
            "groupby-txn-unmapped",
            () =>
              prisma.bankTxn.groupBy({
                by: ["statementId"],
                where: { statementId: { in: statementIds }, ledgerId: null },
                _count: { _all: true },
              }),
            { statementCount: statementIds.length }
          ),
        ])
      : [[], []];

    const totalsById = new Map(txnTotals.map((t) => [t.statementId, t]));
    const unmappedById = new Map(txnUnmapped.map((t) => [t.statementId, t._count._all]));

    const voucherRows = vouchers.map((v) => ({
      id: v.id,
      vendor: v.invoice?.vendor ?? "Unknown",
      invoiceNumber: v.invoice?.invoiceNumber ?? "—",
      type: v.voucherType,
      amount: v.totalDebit,
      status: v.status,
      hasUnmapped: v.lines.some((l) => l.ledgerId === null),
      isDuplicate: v.invoice?.isDuplicate ?? false,
      confidence: v.avgConfidence,
    }));

    const bankRows = statements.map((s) => {
      const totals = totalsById.get(s.id);
      return {
        id: s.id,
        fileName: s.fileName,
        bankName: s.bankName,
        status: s.status,
        txnCount: totals?._count._all ?? 0,
        unmapped: unmappedById.get(s.id) ?? 0,
        totalIn: totals?._sum.deposit ?? 0,
        totalOut: totals?._sum.withdrawal ?? 0,
      };
    });

    return (
      <TransactionsList
        vouchers={voucherRows}
        statements={bankRows}
        initialSyncFilter={sync === "failed" ? "failed" : sync === "stuck" ? "stuck" : null}
      />
    );
  });
}
