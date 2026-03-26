import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
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

    if (!dbUser || dbUser.invoices.length === 0) {
      return NextResponse.json({ error: "No invoices to export" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") || "csv";

    if (format === "csv") {
      const headers = [
        "Invoice #", "Vendor", "Vendor GSTIN", "Date", "Subtotal",
        "CGST", "SGST", "IGST", "Tax", "Total Amount", "GST Valid", "Status"
      ];

      const rows = dbUser.invoices.map((inv) => [
        inv.invoiceNumber || "",
        inv.vendor || "",
        inv.vendorGstin || "",
        inv.date ? new Date(inv.date).toLocaleDateString("en-IN") : "",
        inv.subtotal ?? "",
        inv.cgst ?? "",
        inv.sgst ?? "",
        inv.igst ?? "",
        inv.taxAmount ?? "",
        inv.totalAmount ?? "",
        inv.gstValid != null ? (inv.gstValid ? "Valid" : "Invalid") : "",
        inv.status,
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
      ].join("\n");

      return new Response(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename=invoices_${new Date().toISOString().slice(0, 10)}.csv`,
        },
      });
    }

    // JSON export
    return NextResponse.json({
      exported_at: new Date().toISOString(),
      total: dbUser.invoices.length,
      invoices: dbUser.invoices,
    });

  } catch (error) {
    console.error("[EXPORT_ERROR]", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
