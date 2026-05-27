import { NextResponse } from "next/server";
import { getMockSummary, listMockInvoices } from "@/lib/mockData";

const formatInr = (value: number) => `INR ${value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const buildReply = (message: string) => {
  const invoices = listMockInvoices();
  const summary = getMockSummary(invoices);
  const lower = message.toLowerCase();

  if (lower.includes("tax")) {
    return `Total tax across ${summary.total_invoices} invoices is ${formatInr(summary.total_tax)}.`;
  }

  if (lower.includes("total") || lower.includes("amount")) {
    return `Total amount across ${summary.total_invoices} invoices is ${formatInr(summary.total_amount)}.`;
  }

  if (lower.includes("count") || lower.includes("how many")) {
    return `You have ${summary.total_invoices} invoices in this mock dataset.`;
  }

  if (lower.includes("vendor")) {
    const top = summary.vendor_breakdown.slice(0, 3).map((v) => v.vendor).join(", ");
    return top
      ? `Top vendors in the mock data are: ${top}.`
      : "No vendor data is available in the mock dataset.";
  }

  return `I am running in mock mode. You currently have ${summary.total_invoices} invoices totaling ${formatInr(
    summary.total_amount
  )}. Ask about totals, tax, or vendor breakdowns.`;
};

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
    }

    const reply = buildReply(message);
    return NextResponse.json({ reply });
  } catch (error) {
    console.error("[CHAT_ERROR]", error);
    return NextResponse.json({ reply: "Mock AI assistant error." }, { status: 200 });
  }
}
