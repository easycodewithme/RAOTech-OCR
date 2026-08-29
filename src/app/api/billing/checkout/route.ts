import { NextResponse } from "next/server";
import { getRazorpayInstance } from "@/lib/razorpay";
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

// ── 2. Verify Razorpay Payment Signature ──
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
    const body = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body.toString())
      .digest("hex");

    const isAuthentic = expectedSignature === razorpay_signature;

    if (isAuthentic) {
      return NextResponse.json({
        success: true,
        message: "Payment verified successfully",
        paymentId: razorpay_payment_id,
      });
    } else {
      return NextResponse.json(
        { success: false, message: "Invalid payment signature verification" },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error("[Razorpay Verification Error]:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Signature verification failed" },
      { status: 500 }
    );
  }
}
