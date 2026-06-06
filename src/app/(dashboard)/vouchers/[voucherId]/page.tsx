import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";
import VoucherReview from "./VoucherReview";

export default async function VoucherReviewPage({
  params,
}: {
  params: Promise<{ voucherId: string }>;
}) {
  const user = await getDbUser();
  if (!user) return redirect("/sign-in");
  const { voucherId } = await params;

  await seedLedgersForUser(prisma, user.id);

  const voucher = await prisma.voucher.findFirst({
    where: { id: voucherId, userId: user.id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      invoice: true,
    },
  });
  if (!voucher) return notFound();

  const ledgers = await prisma.ledger.findMany({
    where: { userId: user.id, clientId: "" },
    orderBy: [{ group: "asc" }, { name: "asc" }],
    select: { id: true, name: true, group: true, ledgerType: true },
  });

  // Serialize Dates for the client component
  const serialized = {
    ...voucher,
    date: voucher.date.toISOString(),
    invoice: voucher.invoice
      ? { ...voucher.invoice, date: voucher.invoice.date?.toISOString() ?? null, createdAt: undefined, updatedAt: undefined }
      : null,
  } as any;

  return <VoucherReview voucher={serialized} ledgers={ledgers} />;
}
