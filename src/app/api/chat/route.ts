import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8001";

export async function POST(req: Request) {
  try {
    const { message, history } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message cannot be empty" }, { status: 400 });
    }

    // Forward to FastAPI /chat endpoint (Gemini-powered)
    const response = await fetch(`${BACKEND_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: history || [] }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: "Chat backend error" }));
      return NextResponse.json(
        { reply: errorData.detail || "Sorry, the AI assistant is unavailable right now." },
        { status: 200 } // Return 200 so frontend displays the error message in chat
      );
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
