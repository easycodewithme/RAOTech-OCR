import { NextResponse } from "next/server";
import { getMockSummary, listMockInvoices } from "@/lib/mockData";

export async function GET() {
  try {
    const invoices = listMockInvoices();
    const summary = getMockSummary(invoices);

    return NextResponse.json({ summary });
  } catch (error) {
    console.error("[DASHBOARD_ERROR]", error);
    return NextResponse.json({ error: "Failed to load mock dashboard" }, { status: 500 });
  }
}
