import { NextResponse } from "next/server";
import { getActiveClient } from "@/lib/clientContext";
import { prisma } from "@/lib/prisma";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8001";

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    const { message, history } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
    }

    // Build client-scoped context for the assistant
    let contextPrefix = "";
    if (ctx) {
      const { user, client } = ctx;
      const [invCount, draftCount, latestRecon, itc] = await Promise.all([
        prisma.invoice.count({ where: { userId: user.id, clientId: client.id } }),
        prisma.voucher.count({ where: { userId: user.id, clientId: client.id, status: "DRAFT" } }),
        prisma.gst2bUpload.findFirst({
          where: { userId: user.id, clientId: client.id },
          orderBy: { createdAt: "desc" },
        }),
        prisma.invoice.aggregate({
          where: { userId: user.id, clientId: client.id },
          _sum: { taxAmount: true },
        }),
      ]);
      contextPrefix = `[Active client: ${client.name}. Invoices: ${invCount}. Draft vouchers: ${draftCount}. ITC (tax sum): ₹${itc._sum.taxAmount || 0}. Latest 2B ITC at risk: ₹${latestRecon?.itcAtRisk ?? 0}.]\n\n`;
    }

    const response = await fetch(`${BACKEND_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: contextPrefix + message,
        history: history || [],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: "Chat backend error" }));
      // Fallback local answers for common CA questions when backend is down
      const local = localClientAnswer(message, ctx?.client.name || "this client");
      return NextResponse.json({
        reply: local || errorData.detail || "Sorry, the AI assistant is unavailable right now.",
      });
    }

    const data = await response.json();
    return NextResponse.json({ reply: data.reply || data.response || "No response from AI." });
  } catch (error) {
    console.error("[CHAT_ERROR]", error);
    return NextResponse.json(
      { reply: "Failed to connect to AI backend. Is the Python server running?" },
      { status: 200 }
    );
  }
}

function localClientAnswer(message: string, clientName: string) {
  const m = message.toLowerCase();
  if (m.includes("itc")) {
    return `For ${clientName}, open GST Recon to see ITC eligible vs at-risk based on the latest GSTR-2B match.`;
  }
  if (m.includes("unpaid") || m.includes("outstanding")) {
    return `Open Reports → Party outstanding for ${clientName} to see creditor balances from purchase vouchers.`;
  }
  return null;
}
