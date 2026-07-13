import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

export async function GET(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") || "csv";

    const invoices = await prisma.invoice.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
    });

    if (!invoices.length) {
      return NextResponse.json({ error: "No invoices to export" }, { status: 404 });
    }

    if (format === "csv") {
      const headers = [
        "Invoice #",
        "Vendor",
        "Vendor GSTIN",
        "Date",
        "Subtotal",
        "CGST",
        "SGST",
        "IGST",
        "Tax",
        "Total Amount",
        "GST Valid",
        "Status",
        "Doc Type",
      ];

      const rows = invoices.map((inv) => [
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
        inv.documentType || "",
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
      ].join("\n");

      return new Response(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename=invoices_${client.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`,
        },
      });
    }

    return NextResponse.json({
      exported_at: new Date().toISOString(),
      client: client.name,
      total: invoices.length,
      invoices,
    });
  } catch (error) {
    console.error("[EXPORT_ERROR]", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
