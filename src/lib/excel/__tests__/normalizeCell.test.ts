import { describe, it, expect } from "vitest";
import {
  excelSerialToDate,
  isBlankToken,
  normalizeCell,
  normalizeWhitespace,
  parseAmountText,
  parseDateText,
  parseNumericText,
  toDate,
  toNumber,
  toText,
} from "../normalizeCell";

const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

describe("normalizeWhitespace", () => {
  it("trims, because a trailing space in a name breaks the Tally import", () => {
    expect(normalizeWhitespace("  Acme Traders  ")).toBe("Acme Traders");
  });

  it("collapses internal runs", () => {
    expect(normalizeWhitespace("Acme    Traders")).toBe("Acme Traders");
  });

  it("strips non-breaking spaces, which are invisible in Excel", () => {
    expect(normalizeWhitespace(" Acme Traders ")).toBe("Acme Traders");
    expect(normalizeWhitespace("Acme Traders")).toBe("Acme Traders");
  });

  it("deletes zero-width characters rather than turning them into spaces", () => {
    expect(normalizeWhitespace("Ac​me")).toBe("Acme");
    expect(normalizeWhitespace("﻿Invoice No")).toBe("Invoice No");
  });

  it("folds tabs and newlines out of a multi-line cell", () => {
    expect(normalizeWhitespace("Acme\nTraders\tPvt Ltd")).toBe("Acme Traders Pvt Ltd");
  });
});

describe("blank tokens", () => {
  it.each(["", "-", "--", "NA", "n/a", "N.A.", "nil", "None", "not applicable", "#N/A"])(
    "treats %s as empty",
    (value) => {
      expect(isBlankToken(value)).toBe(true);
      expect(normalizeCell(value)).toBeNull();
    }
  );

  it("does not treat a real value as empty", () => {
    expect(isBlankToken("Nalanda Traders")).toBe(false);
    expect(isBlankToken("0")).toBe(false);
  });
});

describe("day-first dates", () => {
  it("reads 03/04/2026 as 3 April, never 4 March", () => {
    expect(iso(parseDateText("03/04/2026"))).toBe("2026-04-03");
  });

  it("reads every ambiguous day-first date the same way", () => {
    expect(iso(parseDateText("05/08/2024"))).toBe("2024-08-05");
    expect(iso(parseDateText("01/02/2026"))).toBe("2026-02-01");
    expect(iso(parseDateText("12/12/2026"))).toBe("2026-12-12");
  });

  it("accepts the four documented separators", () => {
    expect(iso(parseDateText("03/04/2026"))).toBe("2026-04-03");
    expect(iso(parseDateText("03-04-2026"))).toBe("2026-04-03");
    expect(iso(parseDateText("03.04.2026"))).toBe("2026-04-03");
    expect(iso(parseDateText("2026-04-03"))).toBe("2026-04-03");
  });

  it("reads DD-MMM-YYYY, which their AJIO guide asks users to produce", () => {
    expect(iso(parseDateText("27-MAY-2025"))).toBe("2025-05-27");
    expect(iso(parseDateText("27 May 2025"))).toBe("2025-05-27");
    expect(iso(parseDateText("May 27, 2025"))).toBe("2025-05-27");
  });

  it("expands two-digit years around 1970", () => {
    expect(iso(parseDateText("03/04/26"))).toBe("2026-04-03");
    expect(iso(parseDateText("03/04/99"))).toBe("1999-04-03");
  });

  it("falls back to month-first only when day-first is impossible", () => {
    expect(iso(parseDateText("04/13/2026"))).toBe("2026-04-13");
  });

  it("rejects a date that is not a real day", () => {
    expect(parseDateText("31/02/2026")).toBeNull();
    expect(parseDateText("32/01/2026")).toBeNull();
    expect(parseDateText("00/04/2026")).toBeNull();
  });

  it("drops a time component", () => {
    expect(iso(parseDateText("2026-04-03T00:00:00Z"))).toBe("2026-04-03");
    expect(iso(parseDateText("03/04/2026 14:30"))).toBe("2026-04-03");
  });

  it("builds at UTC midnight so the day cannot drift with the timezone", () => {
    const date = parseDateText("03/04/2026") as Date;
    expect(date.getUTCHours()).toBe(0);
    expect(date.toISOString()).toBe("2026-04-03T00:00:00.000Z");
  });

  it("is not fooled by an invoice number", () => {
    expect(parseDateText("GST/2026/04")).toBeNull();
    expect(normalizeCell("INV/2026/0041")).toBe("INV/2026/0041");
  });
});

describe("Excel serial dates", () => {
  it("converts a serial through the 1899-12-30 epoch", () => {
    expect(iso(excelSerialToDate(46129))).toBe("2026-04-17");
    expect(iso(excelSerialToDate(25569))).toBe("1970-01-01");
  });

  it("keeps the time from a fractional serial", () => {
    const noon = excelSerialToDate(46129.5) as Date;
    expect(noon.toISOString()).toBe("2026-04-17T12:00:00.000Z");
  });

  it("refuses serials Excel itself gets wrong, and impossible ones", () => {
    expect(toDate(60)).toBeNull();
    expect(excelSerialToDate(0)).toBeNull();
    expect(excelSerialToDate(9e9)).toBeNull();
  });

  it("does not convert a serial until a caller says the column is a date", () => {
    expect(normalizeCell(46129)).toBe(46129);
    expect(iso(toDate(46129))).toBe("2026-04-17");
  });
});

describe("Indian number formats", () => {
  it("reads lakh/crore grouping", () => {
    expect(parseNumericText("1,23,456.78")).toBe(123456.78);
    expect(parseNumericText("1,00,00,000")).toBe(10000000);
  });

  it("still reads western grouping", () => {
    expect(parseNumericText("1,234,567.89")).toBe(1234567.89);
  });

  it("strips currency decoration", () => {
    expect(parseNumericText("₹1,200")).toBe(1200);
    expect(parseNumericText("Rs. 1,200.50")).toBe(1200.5);
    expect(parseNumericText("INR 1200")).toBe(1200);
  });

  it("reads parenthesised negatives", () => {
    expect(parseNumericText("(1234)")).toBe(-1234);
    expect(parseNumericText("(₹1,234.50)")).toBe(-1234.5);
    expect(parseNumericText("-1,234")).toBe(-1234);
  });

  it("keeps a Dr/Cr marker instead of guessing its sign", () => {
    expect(parseAmountText("1,200 Cr")).toEqual({ value: 1200, drCr: "CR", percent: false });
    expect(parseAmountText("1,200 Dr.")).toEqual({ value: 1200, drCr: "DR", percent: false });
  });

  it("reads a typed percentage as the rate, not the fraction", () => {
    expect(parseAmountText("18%")).toEqual({ value: 18, drCr: null, percent: true });
  });

  it("returns null for text that is not a number", () => {
    expect(parseNumericText("Acme Traders")).toBeNull();
    expect(parseNumericText("1,2,3,4,5")).toBeNull();
    expect(parseNumericText("NA")).toBeNull();
  });
});

describe("normalizeCell — lossy coercion is refused", () => {
  it("keeps an HSN code with a leading zero as text", () => {
    expect(normalizeCell("0801")).toBe("0801");
    expect(toNumber("0801")).toBe(801);
  });

  it("keeps a reference number too long for a float as text", () => {
    expect(normalizeCell("12345678901234567890")).toBe("12345678901234567890");
  });

  it("still coerces an ordinary amount", () => {
    expect(normalizeCell("1,23,456.78")).toBe(123456.78);
  });
});

describe("normalizeCell — the shapes ExcelJS returns", () => {
  it("flattens rich text", () => {
    expect(normalizeCell({ richText: [{ text: "Acme " }, { text: "Traders " }] })).toBe(
      "Acme Traders"
    );
  });

  it("takes a formula's cached result", () => {
    expect(normalizeCell({ formula: "A1*B1", result: 11800 })).toBe(11800);
    expect(normalizeCell({ sharedFormula: "A1", result: "Acme  Traders" })).toBe("Acme Traders");
  });

  it("returns null for a formula with no cached result, rather than the formula text", () => {
    expect(normalizeCell({ formula: "A1*B1" })).toBeNull();
  });

  it("returns null for an error cell", () => {
    expect(normalizeCell({ error: "#REF!" })).toBeNull();
    expect(normalizeCell({ formula: "A1/0", result: { error: "#DIV/0!" } })).toBeNull();
  });

  it("takes a hyperlink cell's display text", () => {
    expect(normalizeCell({ text: "Acme Traders", hyperlink: "https://example.com" })).toBe(
      "Acme Traders"
    );
    expect(normalizeCell({ hyperlink: "mailto:a@b.com" })).toBe("mailto:a@b.com");
  });

  it("passes through primitives and dates", () => {
    expect(normalizeCell(true)).toBe(true);
    expect(normalizeCell(1180)).toBe(1180);
    expect(normalizeCell(null)).toBeNull();
    expect(normalizeCell(undefined)).toBeNull();
    const date = new Date(Date.UTC(2026, 3, 3));
    expect(normalizeCell(date)).toBe(date);
    expect(normalizeCell(new Date("nope"))).toBeNull();
  });

  it("never stringifies an object it does not understand", () => {
    expect(normalizeCell({ some: "shape" })).toBeNull();
  });

  it("scales a percent-formatted number to the rate it displays", () => {
    expect(normalizeCell(0.18, { numFmt: "0.00%" })).toBe(18);
    expect(normalizeCell(0.025, { numFmt: "0.0%" })).toBe(2.5);
    expect(normalizeCell(0.18)).toBe(0.18);
  });
});

describe("toNumber / toDate / toText", () => {
  it("reads numbers from either representation", () => {
    expect(toNumber(1180)).toBe(1180);
    expect(toNumber("₹1,180")).toBe(1180);
    expect(toNumber(new Date())).toBeNull();
    expect(toNumber(null)).toBeNull();
  });

  it("reads dates from all three representations", () => {
    expect(iso(toDate(new Date(Date.UTC(2026, 3, 3))))).toBe("2026-04-03");
    expect(iso(toDate("03/04/2026"))).toBe("2026-04-03");
    expect(iso(toDate(46129))).toBe("2026-04-17");
    expect(toDate("Acme")).toBeNull();
  });

  it("renders a cell for display", () => {
    expect(toText(null)).toBe("");
    expect(toText(new Date(Date.UTC(2026, 3, 3)))).toBe("2026-04-03");
    expect(toText(" Acme  Traders ")).toBe("Acme Traders");
    expect(toText(1180)).toBe("1180");
  });
});
