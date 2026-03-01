import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server"; // Changed from 'auth' to 'currentUser' to get email
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    // 1. Get the full User object from Clerk
    const user = await currentUser();
    
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. SYNC: Ensure User exists in our Postgres Database
    // We try to find them by 'email'. If found, we do nothing. If not, we create them.
    const email = user.emailAddresses[0]?.emailAddress;
    
    const dbUser = await prisma.user.upsert({
      where: { email: email },
      update: {}, // No updates if they exist
      create: {
        id: user.id, // OPTIONAL: We force the DB ID to match Clerk ID to make life easier
        clerkId: user.id,
        email: email,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        plan: "FREE" 
      },
    });

    // 3. Process the Invoice Data
    const body = await req.json();
    const { extractedData, fileName } = body;

    const cleanMoney = (val: any) => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        return parseFloat(val.replace(/[^0-9.-]+/g,"")) || 0;
      }
      return 0;
    };

    const cleanDate = (val: any) => {
      const d = new Date(val);
      return isNaN(d.getTime()) ? new Date() : d;
    };

    // 4. Save Invoice using the 'dbUser.id'
    const invoice = await prisma.invoice.create({
      data: {
        userId: dbUser.id, // Link to the user we just ensured exists
        fileUrl: `https://fake-storage.com/${fileName}`,
        
        invoiceNumber: extractedData.invoice_number || "UNKNOWN",
        date: cleanDate(extractedData.date),
        totalAmount: cleanMoney(extractedData.total_amount),
        taxAmount: cleanMoney(extractedData.tax),
        
        status: "PROCESSED",
        extractedData: extractedData,
      }
    });

    return NextResponse.json({ success: true, invoice });

  } catch (error) {
    console.error("[INVOICE_SAVE_ERROR]", error);
    return NextResponse.json({ error: "Failed to save invoice" }, { status: 500 });
  }
}