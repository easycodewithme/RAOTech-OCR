import { describe, it, expect } from "vitest";
import { LAYOUT_CONFIDENCE_FLOOR } from "../types";
import { classifyTaxColumn, detectLayout, extractRate } from "../detectLayout";

const LONG_HEADERS = [
  "Invoice No.",
  "Invoice Date",
  "Party Name",
  "GSTIN",
  "Taxable Value",
  "CGST",
  "SGST",
  "IGST",
  "Invoice Total",
];

describe("extractRate", () => {
  it.each([
    ["5%", 5],
    ["5 %", 5],
    ["GST 5", 5],
    ["Taxable 5%", 5],
    ["CGST@9", 9],
    ["SGST @ 2.5", 2.5],
    ["SGST @ 2.5%", 2.5],
    ["18% IGST", 18],
    ["Sales @ 12%", 12],
    ["Cess 0.25%", 0.25],
    ["CGST_14", 14],
    ["Taxable Value 28%", 28],
  ])("reads %s as %s", (header, rate) => {
    expect(extractRate(header)).toBe(rate);
  });

  it.each(["Invoice No.", "Taxable Value", "CGST", "Party Name", "GST Rate", "HSN Code"])(
    "finds no rate in %s",
    (header) => {
      expect(extractRate(header)).toBeNull();
    }
  );

  it("does not read a column number or an HSN code as a rate", () => {
    expect(extractRate("Column 5")).toBeNull();
    expect(extractRate("HSN 9403")).toBeNull();
    expect(extractRate("Invoice No 2")).toBeNull();
  });
});

describe("classifyTaxColumn", () => {
  it.each([
    ["CGST", "CGST"],
    ["C GST", "CGST"],
    ["Central Tax", "CGST"],
    ["SGST", "SGST"],
    ["UTGST", "SGST"],
    ["State Tax", "SGST"],
    ["IGST", "IGST"],
    ["Integrated Tax", "IGST"],
    ["Cess", "CESS"],
    ["Taxable Value", "TAXABLE"],
    ["Assessable Value", "TAXABLE"],
    ["18% Amount", "TAXABLE"],
  ])("classifies %s as %s", (header, kind) => {
    expect(classifyTaxColumn(header)).toBe(kind);
  });

  it("leaves a bare Amount alone, because in a LONG sheet it is the invoice total", () => {
    expect(classifyTaxColumn("Amount")).toBeNull();
    expect(classifyTaxColumn("Invoice Total")).toBeNull();
    expect(classifyTaxColumn("Party Name")).toBeNull();
  });
});

describe("detectLayout — LONG", () => {
  it("reads fixed CGST/SGST/IGST columns as LONG, with confidence to act on", () => {
    const result = detectLayout(LONG_HEADERS);
    expect(result.taxLayout).toBe("LONG");
    expect(result.rateGroups).toEqual([]);
    expect(result.confidence).toBeGreaterThanOrEqual(LAYOUT_CONFIDENCE_FLOOR);
    expect(result.reason).toMatch(/CGST/);
  });

  it("still says LONG with only CGST and SGST, a sheet with no interstate sales", () => {
    const result = detectLayout(["Invoice No", "Party", "Taxable Value", "CGST", "SGST"]);
    expect(result.taxLayout).toBe("LONG");
    expect(result.confidence).toBeGreaterThanOrEqual(LAYOUT_CONFIDENCE_FLOOR);
  });

  it("asks rather than assumes when a sheet has no tax columns at all", () => {
    const result = detectLayout(["Invoice No", "Date", "Party", "Amount"]);
    expect(result.taxLayout).toBe("LONG");
    expect(result.confidence).toBeLessThan(LAYOUT_CONFIDENCE_FLOOR);
    expect(result.reason).toMatch(/no repeating per-rate column groups/i);
  });

  it("names the columns it saw, so the guess is auditable", () => {
    const result = detectLayout(LONG_HEADERS);
    expect(result.reason).toContain('"CGST"');
    expect(result.reason).toContain('"IGST"');
  });
});

describe("detectLayout — WIDE", () => {
  const WIDE_HEADERS = [
    "Invoice No",
    "Date",
    "Party",
    "5% Taxable",
    "5% CGST",
    "5% SGST",
    "12% Taxable",
    "12% CGST",
    "12% SGST",
    "18% Taxable",
    "18% CGST",
    "18% SGST",
  ];

  it("finds one group per rate", () => {
    const result = detectLayout(WIDE_HEADERS);
    expect(result.taxLayout).toBe("WIDE");
    expect(result.rateGroups.map((g) => g.rate)).toEqual([5, 12, 18]);
    expect(result.confidence).toBeGreaterThanOrEqual(LAYOUT_CONFIDENCE_FLOOR);
  });

  it("maps each group to its own columns", () => {
    const result = detectLayout(WIDE_HEADERS);
    expect(result.rateGroups[0]).toEqual({ rate: 5, taxable: 3, cgst: 4, sgst: 5, igst: null });
    expect(result.rateGroups[2]).toEqual({ rate: 18, taxable: 9, cgst: 10, sgst: 11, igst: null });
  });

  it("groups columns that are neither contiguous nor in rate order", () => {
    const scrambled = [
      "Invoice No",
      "18% Taxable",
      "5% Taxable",
      "18% CGST",
      "5% CGST",
      "18% SGST",
      "5% SGST",
      "12% Taxable",
      "12% CGST",
      "12% SGST",
    ];
    const result = detectLayout(scrambled);
    expect(result.taxLayout).toBe("WIDE");
    expect(result.rateGroups).toEqual([
      { rate: 5, taxable: 2, cgst: 4, sgst: 6, igst: null },
      { rate: 12, taxable: 7, cgst: 8, sgst: 9, igst: null },
      { rate: 18, taxable: 1, cgst: 3, sgst: 5, igst: null },
    ]);
    expect(result.reason).toMatch(/header text rather than column position/);
  });

  it("folds half-rate tax columns into their parent slab", () => {
    const result = detectLayout([
      "Invoice No",
      "Taxable@5",
      "SGST@2.5",
      "CGST@2.5",
      "Taxable@12",
      "SGST@6",
      "CGST@6",
    ]);
    expect(result.taxLayout).toBe("WIDE");
    expect(result.rateGroups).toEqual([
      { rate: 5, taxable: 1, cgst: 3, sgst: 2, igst: null },
      { rate: 12, taxable: 4, cgst: 6, sgst: 5, igst: null },
    ]);
    expect(result.reason).toMatch(/Half-rate columns/);
  });

  it("folds a half rate even when no taxable column names the slab", () => {
    const result = detectLayout(["Invoice No", "CGST 9", "SGST 9", "CGST 2.5", "SGST 2.5"]);
    expect(result.taxLayout).toBe("WIDE");
    expect(result.rateGroups.map((g) => g.rate)).toEqual([5, 18]);
  });

  it("handles an IGST-only wide sheet", () => {
    const result = detectLayout(["Invoice No", "5% Taxable", "5% IGST", "18% Taxable", "18% IGST"]);
    expect(result.taxLayout).toBe("WIDE");
    expect(result.rateGroups).toEqual([
      { rate: 5, taxable: 1, cgst: null, sgst: null, igst: 2 },
      { rate: 18, taxable: 3, cgst: null, sgst: null, igst: 4 },
    ]);
  });

  it("reads a rate-wise taxable summary with no tax columns as WIDE", () => {
    const result = detectLayout(["Party", "Sales @ 5%", "Sales @ 12%", "Sales @ 18%"]);
    expect(result.taxLayout).toBe("WIDE");
    expect(result.rateGroups.map((g) => g.rate)).toEqual([5, 12, 18]);
  });

  it("lists the rates it found, so the guess is auditable", () => {
    const result = detectLayout(WIDE_HEADERS);
    expect(result.reason).toContain("5%");
    expect(result.reason).toContain("12%");
    expect(result.reason).toContain("18%");
  });

  it("needs two groups before it will call a sheet WIDE", () => {
    const result = detectLayout(["Invoice No", "5% Taxable", "5% CGST", "5% SGST"]);
    expect(result.taxLayout).toBe("LONG");
  });
});

describe("detectLayout — a mixed sheet is flagged, not guessed at", () => {
  it("drops below the floor when both shapes are present", () => {
    const result = detectLayout([
      "Invoice No",
      "Taxable Value",
      "CGST",
      "SGST",
      "IGST",
      "5% Taxable",
      "12% Taxable",
    ]);
    expect(result.confidence).toBeLessThan(LAYOUT_CONFIDENCE_FLOOR);
    expect(result.reason).toMatch(/mixed/i);
  });

  it("never returns a confidence outside 0-1", () => {
    for (const headers of [[], ["a"], LONG_HEADERS, ["5% CGST", "12% CGST", "18% CGST"]]) {
      const { confidence } = detectLayout(headers);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });

  it("survives an empty header list", () => {
    const result = detectLayout([]);
    expect(result.taxLayout).toBe("LONG");
    expect(result.rateGroups).toEqual([]);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
