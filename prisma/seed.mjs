import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "demo@example.com" },
    update: {},
    create: {
      clerkId: "user_demo_seed_001",
      email: "demo@example.com",
      name: "Demo User",
      plan: "FREE",
    },
  });

  await prisma.invoice.createMany({
    data: [
      {
        userId: user.id,
        fileUrl: "https://example.com/invoices/sample-001.pdf",
        status: "PROCESSED",
        invoiceNumber: "INV-2026-001",
        date: new Date("2026-03-15"),
        vendor: "Acme Supplies Pvt Ltd",
        vendorGstin: "27AABCA1234F1Z5",
        vendorAddress: "Mumbai, Maharashtra",
        vendorPhone: "+91-9876543210",
        customerName: "Demo User",
        customerGstin: "27AAPCD5678G1Z9",
        subtotal: 10000,
        cgst: 900,
        sgst: 900,
        igst: 0,
        taxAmount: 1800,
        totalAmount: 11800,
        discount: 0,
        gstValid: true,
        gstState: "Maharashtra",
        ocrEngine: "nemotron-vl",
        processingTime: 2.4,
      },
      {
        userId: user.id,
        fileUrl: "https://example.com/invoices/sample-002.pdf",
        status: "PROCESSED",
        invoiceNumber: "INV-2026-002",
        date: new Date("2026-03-28"),
        vendor: "Bharat Office Mart",
        vendorGstin: "29AAECB9876K1Z3",
        vendorAddress: "Bengaluru, Karnataka",
        customerName: "Demo User",
        customerGstin: "27AAPCD5678G1Z9",
        subtotal: 5500,
        cgst: 0,
        sgst: 0,
        igst: 990,
        taxAmount: 990,
        totalAmount: 6490,
        discount: 0,
        gstValid: true,
        gstState: "Karnataka",
        ocrEngine: "nemotron-vl",
        processingTime: 1.8,
      },
      {
        userId: user.id,
        fileUrl: "https://example.com/invoices/sample-003.pdf",
        status: "PENDING",
        invoiceNumber: null,
        ocrEngine: null,
      },
    ],
  });

  const counts = {
    users: await prisma.user.count(),
    invoices: await prisma.invoice.count(),
  };
  console.log("Seed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
