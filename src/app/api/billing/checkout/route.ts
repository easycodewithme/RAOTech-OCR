import { NextResponse } from "next/server";
import { getRazorpayInstance } from "@/lib/razorpay";
import { getDbUser } from "@/lib/getDbUser";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

const INDIVIDUAL_MONTHLY_PRICE = 1499;
const ENTERPRISE_UNIT_MONTHLY_PRICE = 499;
const YEARLY_DISCOUNT = 0.2;

// ── 1. Create Razorpay Order ──
export async function POST(req: Request) {
  try {
    const { plan, billing, users } = await req.json();

    const isYearly = billing === "yearly";
    const seatCount = plan === "individual" ? 1 : Math.max(users || 1, 1);

    const monthlyUnitPrice =
      plan === "individual" ? INDIVIDUAL_MONTHLY_PRICE : ENTERPRISE_UNIT_MONTHLY_PRICE;

    const unitPrice = isYearly
      ? Math.round(monthlyUnitPrice * (1 - YEARLY_DISCOUNT))
      : monthlyUnitPrice;

    // Total in INR (for yearly billing, multiply by 12 months)
    const totalINR = unitPrice * seatCount * (isYearly ? 12 : 1);
    const amountInPaise = totalINR * 100;

    const razorpay = getRazorpayInstance();

    // Create Order with Razorpay
    const order = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: `rcpt_${Date.now()}`,
      notes: {
        plan,
        billing,
        seatCount: seatCount.toString(),
      },
    });

    return NextResponse.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    });
  } catch (error: any) {
    console.error("[Razorpay Checkout Order Error]:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to create payment order" },
      { status: 500 }
    );
  }
}

// ── 2. Verify Razorpay Payment Signature, then persist Org/Subscription ──
export async function PUT(req: Request) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = await req.json();

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return NextResponse.json(
        { success: false, error: "Server misconfiguration: missing payment secret" },
        { status: 500 }
      );
    }

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json(
        { success: false, message: "Invalid payment signature verification" },
        { status: 400 }
      );
    }

    // Re-read plan/billing/seatCount from the order's own notes (set server-side
    // at order-creation time) rather than trusting anything the client sends on
    // this call — the client only ever proves it holds a signature for THIS
    // order, not what the order was for.
    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.fetch(razorpay_order_id);
    const notes = (order.notes || {}) as Record<string, string>;
    const plan = notes.plan === "enterprise" ? "ENTERPRISE" : "INDIVIDUAL";
    const billingCycle = notes.billing === "yearly" ? "YEARLY" : "MONTHLY";
    const seatCount = Math.max(parseInt(notes.seatCount || "1", 10) || 1, 1);
    const totalAmount =
      typeof order.amount === "number" ? order.amount : parseInt(String(order.amount), 10) || 0;

    const dbUser = await getDbUser();
    if (!dbUser) {
      return NextResponse.json(
        { success: false, error: "You must be signed in to complete checkout." },
        { status: 401 }
      );
    }

    // One org per paying user for now: reuse an existing owned org if present,
    // otherwise create one. A user paying twice (e.g. upgrading seats) should
    // extend their existing org's subscription, not fork a second workspace.
    let organization = await prisma.organization.findFirst({
      where: { ownerId: dbUser.id },
    });

    if (!organization) {
      const slugBase = (dbUser.name || dbUser.email.split("@")[0] || "workspace")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const slug = `${slugBase || "workspace"}-${crypto.randomBytes(3).toString("hex")}`;

      organization = await prisma.organization.create({
        data: {
          name: dbUser.name ? `${dbUser.name}'s Organization` : "My Organization",
          slug,
          ownerId: dbUser.id,
          plan,
          billingCycle,
          maxSeats: seatCount,
          members: {
            create: { userId: dbUser.id, role: "CA" },
          },
        },
      });
    } else {
      organization = await prisma.organization.update({
        where: { id: organization.id },
        data: {
          plan,
          billingCycle,
          // Never shrink an existing seat allocation from a later purchase;
          // take the larger of the two so a top-up can only add capacity.
          maxSeats: Math.max(organization.maxSeats, seatCount),
        },
      });
    }

    await prisma.subscription.create({
      data: {
        orgId: organization.id,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        plan,
        billingCycle,
        seatCount,
        pricePerSeat: seatCount > 0 ? Math.round(totalAmount / seatCount) : totalAmount,
        totalAmount,
        status: "ACTIVE",
        paidAt: new Date(),
        expiresAt: new Date(
          Date.now() + (billingCycle === "YEARLY" ? 365 : 30) * 24 * 60 * 60 * 1000
        ),
      },
    });

    return NextResponse.json({
      success: true,
      message: "Payment verified successfully",
      paymentId: razorpay_payment_id,
      orgId: organization.id,
      maxSeats: organization.maxSeats,
    });
  } catch (error: any) {
    console.error("[Razorpay Verification Error]:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Signature verification failed" },
      { status: 500 }
    );
  }
}
