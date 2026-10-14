import { describe, it, expect } from "vitest";
import { correctExtraction, parseAmountInWords } from "../correctExtraction";
import { cleanMoney } from "../../accounting/normalize";

describe("parseAmountInWords", () => {
  it("parses lakhs and thousands correctly", () => {
    expect(parseAmountInWords("INR Four Lakh Sixteen Thousand Only")).toBe(416000);
    expect(parseAmountInWords("Three Lakh Ninety Six Thousand One Hundred Ninety")).toBe(396190);
  });
});

describe("correctExtraction", () => {
  it("reverses GSTIN swap when vendor address state matches customer GSTIN", () => {
    const raw = {
      vendor: "KALPATARU AUTOMOBILES - (2026-27)",
      vendor_address: "Near Shri Hari Party Plot, Kalol-Mansa Road, Kalol,Dist:Gandhinagar Gujarat",
      vendor_gstin: "24AABCJ8501F1ZY",
      customer_name: "Jsw Infrastructure Pvt. Ltd.",
      customer_gstin: "24AATFK1007E1ZO",
      total_amount: 416,
      amount_in_words: "Four Lakh Sixteen Thousand Only",
      subtotal: 396.19,
      cgst: 9.90,
      sgst: 9.90,
      items: [
        { name: "1 JIVO-225 4 WD PS", price: 396.19, qty: 1 }
      ]
    };

    const { data, corrections } = correctExtraction(raw);

    expect(data.vendor_gstin).toBe("24AATFK1007E1ZO");
    expect(data.customer_gstin).toBe("24AABCJ8501F1ZY");
    expect(data.total_amount).toBe(416000);
    expect(data.subtotal).toBe(396190);
    expect(data.cgst).toBe(9900);
    expect(data.sgst).toBe(9900);
    expect(corrections.length).toBeGreaterThan(0);
  });

  it("finds correct vendor GSTIN from raw OCR text when both vendor and customer GSTIN are extracted as customer GSTIN", () => {
    const raw = {
      vendor: "KALPATARU AUTOMOBILES - (2026-27)",
      vendor_address: "Kalol, Gujarat",
      vendor_gstin: "24AABCJ8501F1ZY",
      customer_name: "Jsw Infrastructure Pvt. Ltd.",
      customer_gstin: "24AAACJ8501F1ZY",
      total_amount: 416000,
      amount_in_words: "Four Lakh Sixteen Thousand Only",
      subtotal: 396190,
      cgst: 9904.75,
      sgst: 9904.75,
      raw_ocr_text: "GSTIN/UIN: 24AATFK1007E1ZO Company PAN: AATFK1007E Seller: KALPATARU AUTOMOBILES"
    };

    const { data, corrections } = correctExtraction(raw);

    expect(data.vendor_gstin).toBe("24AATFK1007E1ZO");
    expect(corrections.some(c => c.includes("24AATFK1007E1ZO"))).toBe(true);
  });
});

describe("cleanMoney", () => {
  it("handles Indian format comma numbers", () => {
    expect(cleanMoney("3,96,190.19")).toBe(396190.19);
    expect(cleanMoney("₹4,16,000.00")).toBe(416000);
  });
});
