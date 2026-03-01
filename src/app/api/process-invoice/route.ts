import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // --- START: MICROSERVICE 2 CONNECTION ---
    // In the future, you will replace this block with:
    // const externalResponse = await fetch('YOUR_PYTHON_MICROSERVICE_URL', { body: formData });
    // const result = await externalResponse.json();
    
    // For now, we simulate the OCR response so you can test the Frontend Table
    // Simulate a 2-second delay
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const mockResponse = {
      invoice_number: "INV-2024-001",
      date: "2024-12-10",
      total_amount: "$1,250.00",
      vendor: "Tech Solutions Inc.",
      items: [
        { name: "Server Maintenance", qty: 1, price: 500 },
        { name: "Consulting Hours", qty: 5, price: 150 }
      ],
      tax: "$100.00"
    };
    // --- END: MICROSERVICE 2 CONNECTION ---

    return NextResponse.json(mockResponse);
    
  } catch (error) {
    console.error("[UPLOAD_ERROR]", error);
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}