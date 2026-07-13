import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";
import VoucherReview from "./VoucherReview";

export default async function VoucherReviewPage({
  params,
}: {
  params: Promise<{ voucherId: string }>;
}) {
  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");
  const { user, client } = ctx;
  const { voucherId } = await params;

  await seedLedgersForUser(prisma, user.id, client.id);

  const voucher = await prisma.voucher.findFirst({
    where: { id: voucherId, userId: user.id, clientId: client.id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      invoice: true,
    },
  });
  if (!voucher) return notFound();

  // Neighbor vouchers for keyboard nav
  const siblings = await prisma.voucher.findMany({
    where: { userId: user.id, clientId: client.id, status: "DRAFT" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const idx = siblings.findIndex((s) => s.id === voucherId);
  const prevId = idx > 0 ? siblings[idx - 1].id : null;
  const nextId = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].id : null;

  const ledgers = await prisma.ledger.findMany({
    where: { userId: user.id, clientId: client.id },
    orderBy: [{ group: "asc" }, { name: "asc" }],
    select: { id: true, name: true, group: true, ledgerType: true },
  });

  const serialized = {
    ...voucher,
    date: voucher.date.toISOString(),
    invoice: voucher.invoice
      ? {
          ...voucher.invoice,
          date: voucher.invoice.date?.toISOString() ?? null,
          createdAt: undefined,
          updatedAt: undefined,
        }
      : null,
  } as any;

  return (
    <VoucherReview
      voucher={serialized}
      ledgers={ledgers}
      prevId={prevId}
      nextId={nextId}
    />
  );
}
