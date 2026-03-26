import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = user.emailAddresses[0]?.emailAddress;
    const dbUser = await prisma.user.findUnique({
      where: { email },
      include: { invoices: { orderBy: { createdAt: "desc" } } },
    });

    if (!dbUser) {
      return NextResponse.json({
        summary: {
          total_invoices: 0,
          total_amount: 0,
          total_tax: 0,
          unique_vendors: 0,
          avg_amount: 0,
          period_breakdown: {},
          vendor_breakdown: [],
        },
      });
    }

    const invoices = dbUser.invoices;
    const totalAmount = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
    const totalTax = invoices.reduce((sum, inv) => sum + (inv.taxAmount || 0), 0);
    const uniqueVendors = new Set(invoices.map((inv) => inv.vendor).filter(Boolean)).size;

    // Period breakdown (monthly)
    const periodBreakdown: Record<string, number> = {};
    for (const inv of invoices) {
      const date = inv.date || inv.createdAt;
      const monthKey = new Date(date).toISOString().slice(0, 7); // YYYY-MM
      periodBreakdown[monthKey] = (periodBreakdown[monthKey] || 0) + (inv.totalAmount || 0);
    }

    // Vendor breakdown
    const vendorMap: Record<string, { vendor: string; count: number; total_amount: number; total_tax: number }> = {};
    for (const inv of invoices) {
      const v = inv.vendor || "Unknown";
      if (!vendorMap[v]) {
        vendorMap[v] = { vendor: v, count: 0, total_amount: 0, total_tax: 0 };
      }
      vendorMap[v].count += 1;
      vendorMap[v].total_amount += inv.totalAmount || 0;
      vendorMap[v].total_tax += inv.taxAmount || 0;
    }

    const vendorBreakdown = Object.values(vendorMap)
      .map((v) => ({ ...v, avg_invoice_value: v.count > 0 ? v.total_amount / v.count : 0 }))
      .sort((a, b) => b.total_amount - a.total_amount);

    return NextResponse.json({
      summary: {
        total_invoices: invoices.length,
        total_amount: totalAmount,
        total_tax: totalTax,
        unique_vendors: uniqueVendors,
        avg_amount: invoices.length > 0 ? totalAmount / invoices.length : 0,
        period_breakdown: Object.fromEntries(Object.entries(periodBreakdown).sort()),
        vendor_breakdown: vendorBreakdown,
      },
    });

  } catch (error) {
    console.error("[DASHBOARD_ERROR]", error);
    return NextResponse.json({ error: "Failed to load dashboard" }, { status: 500 });
  }
}
