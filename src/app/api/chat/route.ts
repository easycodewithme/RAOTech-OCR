import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    // --- CONNECT TO YOUR AI MICROSERVICE HERE ---
    // const aiResponse = await fetch("YOUR_PYTHON_MICROSERVICE_URL", {
    //   method: "POST",
    //   body: JSON.stringify({ query: message })
    // });
    // const data = await aiResponse.json();
    // return NextResponse.json({ reply: data.answer });

    // --- MOCK RESPONSE FOR UI TESTING ---
    // Simulate thinking delay
    await new Promise((resolve) => setTimeout(resolve, 1500));

    let reply = "I can help you analyze your invoices. Try asking 'What is my total expense?'";
    
    if (message.toLowerCase().includes("total")) {
      reply = "Based on your recent invoices, your total spending is ₹1,25,000.";
    } else if (message.toLowerCase().includes("how many")) {
      reply = "You have uploaded 12 invoices this month.";
    }

    return NextResponse.json({ reply });

  } catch (error) {
    console.error("[CHAT_ERROR]", error);
    return NextResponse.json({ error: "Failed to process query" }, { status: 500 });
  }
}