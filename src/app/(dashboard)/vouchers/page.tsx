import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import VoucherQueue from "./VoucherQueue";

export default async function VouchersPage() {
  const user = await getDbUser();
  if (!user) return redirect("/sign-in");

  const vouchers = await prisma.voucher.findMany({
    where: { userId: user.id, clientId: "" },
    orderBy: { createdAt: "desc" },
    include: {
      invoice: { select: { vendor: true, invoiceNumber: true } },
      lines: { select: { ledgerId: true } },
    },
  });

  const rows = vouchers.map((v) => ({
    id: v.id,
    voucherType: v.voucherType,
    status: v.status,
    date: v.date.toISOString(),
    totalDebit: v.totalDebit,
    totalCredit: v.totalCredit,
    hasUnmapped: v.lines.some((l) => l.ledgerId === null),
    vendor: v.invoice?.vendor ?? null,
    invoiceNumber: v.invoice?.invoiceNumber ?? null,
  }));

  return <VoucherQueue vouchers={rows} />;
}
