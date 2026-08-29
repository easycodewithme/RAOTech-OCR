import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { findTemplates, saveTemplate, recordTemplateUse, applyTemplate } from "../templates";
import {
  BUILTIN_TEMPLATES,
  builtinToMapping,
  matchBuiltinTemplates,
  builtinFingerprint,
  builtinPreparedFingerprint,
  findBuiltinTemplate,
  isBuiltinTemplateId,
} from "../builtinTemplates";
import { headerFingerprint } from "../detectHeader";
import type { FieldMapping, GstMapping, LedgerMapping, SheetMapping } from "../types";

// ---------------------------------------------------------------------------
// Fake prisma — the same cast the rest of the suite uses for DB-backed helpers
// ---------------------------------------------------------------------------

interface StoredTemplate {
  id: string;
  name: string;
  clientId: string;
  itemMode: string;
  headers: string[];
  headerFingerprint: string;
  hitCount: number;
  lastUsedAt: Date;
  isBuiltIn: boolean;
}

interface FindManyArgs {
  where: Record<string, unknown>;
}
interface UpsertArgs {
  where: {
    userId_clientId_docType_headerFingerprint: {
      userId: string;
      clientId: string;
      docType: string;
      headerFingerprint: string;
    };
  };
  create: { name: string; headerFingerprint: string; hitCount: number };
  update: { hitCount: { increment: number }; lastUsedAt: Date };
}
interface UpdateArgs {
  where: { id: string };
  data: { hitCount: { increment: number }; lastUsedAt: Date };
}

function fakeDb(rows: StoredTemplate[]) {
  const calls = {
    findMany: vi.fn(async (_args: FindManyArgs) => rows),
    upsert: vi.fn(async (args: UpsertArgs) => ({
      id: "saved-1",
      name: args.create.name,
      headerFingerprint: args.create.headerFingerprint,
      hitCount: 1,
    })),
    update: vi.fn(async (_args: UpdateArgs) => ({})),
  };
  return {
    prisma: { mappingTemplate: calls } as unknown as PrismaClient,
    calls,
  };
}

const SHEET_HEADERS = ["Invoice No", "Invoice Date", "Party Name", "Taxable Value", "Total"];
const SHEET_FINGERPRINT = headerFingerprint(SHEET_HEADERS);

const stored = (over: Partial<StoredTemplate>): StoredTemplate => ({
  id: "t1",
  name: "Template",
  clientId: "CLIENT_A",
  itemMode: "WITHOUT_ITEM",
  headers: SHEET_HEADERS,
  headerFingerprint: SHEET_FINGERPRINT,
  hitCount: 1,
  lastUsedAt: new Date("2026-01-01"),
  isBuiltIn: false,
  ...over,
});

const args = {
  userId: "USER",
  clientId: "CLIENT_A",
  docType: "SALE" as const,
  headers: SHEET_HEADERS,
  includeBuiltIns: false,
};

// ---------------------------------------------------------------------------
// findTemplates
// ---------------------------------------------------------------------------

describe("findTemplates — ranking", () => {
  it("searches across the whole firm, not just this client", async () => {
    const { prisma, calls } = fakeDb([]);
    await findTemplates(prisma, args);
    const where = calls.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ userId: "USER", docType: "SALE" });
    expect(where).not.toHaveProperty("clientId");
  });

  it("puts this client's exact match first, then another client's", async () => {
    const { prisma } = fakeDb([
      stored({ id: "other", clientId: "CLIENT_B", name: "B's Tally export" }),
      stored({ id: "mine", clientId: "CLIENT_A", name: "A's Tally export" }),
    ]);
    const matches = await findTemplates(prisma, args);
    expect(matches.map((m) => m.templateId)).toEqual(["mine", "other"]);
    expect(matches[0].score).toBe(1);
    expect(matches[1].score).toBe(0.9);
  });

  it("offers another client's mapping at all — clients 2 to 200 need no mapping session", async () => {
    const { prisma } = fakeDb([stored({ id: "other", clientId: "CLIENT_B" })]);
    const matches = await findTemplates(prisma, args);
    expect(matches).toHaveLength(1);
    expect(matches[0].templateId).toBe("other");
  });

  it("falls back to header overlap when the fingerprint has moved", async () => {
    const renamed = ["Invoice No", "Invoice Date", "Party Name", "Taxable Value", "Bill Total"];
    const { prisma } = fakeDb([stored({ id: "fuzzy", headerFingerprint: "h1-somethingelse" })]);
    const matches = await findTemplates(prisma, { ...args, headers: renamed });
    expect(matches).toHaveLength(1);
    expect(matches[0].score).toBeLessThan(0.9);
    expect(matches[0].missingHeaders).toEqual(["Total"]);
  });

  it("ignores a template that merely shares a Date column", async () => {
    const { prisma } = fakeDb([
      stored({
        id: "unrelated",
        headerFingerprint: "h1-other",
        headers: ["Invoice Date", "Broker", "Scrip", "Units", "Price", "Charges"],
      }),
    ]);
    expect(await findTemplates(prisma, args)).toEqual([]);
  });

  it("breaks a tie on what has been used most", async () => {
    const { prisma } = fakeDb([
      stored({ id: "cold", clientId: "CLIENT_B", hitCount: 1 }),
      stored({ id: "hot", clientId: "CLIENT_C", hitCount: 40 }),
    ]);
    const matches = await findTemplates(prisma, args);
    expect(matches[0].templateId).toBe("hot");
  });

  it("demotes a mapping saved for the other item mode without hiding it", async () => {
    const { prisma } = fakeDb([stored({ id: "items", itemMode: "WITH_ITEM" })]);
    const matches = await findTemplates(prisma, { ...args, itemMode: "WITHOUT_ITEM" });
    expect(matches).toHaveLength(1);
    expect(matches[0].score).toBeLessThan(1);
  });

  it("includes the shipped layouts when asked", async () => {
    const { prisma } = fakeDb([]);
    const matches = await findTemplates(prisma, {
      ...args,
      docType: "SALE",
      headers: BUILTIN_TEMPLATES[0].headers,
      includeBuiltIns: true,
    });
    expect(matches.some((m) => m.isBuiltIn)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// saveTemplate / recordTemplateUse
// ---------------------------------------------------------------------------

const emptyFields: FieldMapping = {
  invoiceNumber: 0, date: 1, partyName: 2, partyGstin: null, narration: null,
  taxable: 3, total: 4, discount: null, roundOff: null,
  itemName: null, quantity: null, rate: null, amount: null, hsnCode: null,
  ledgerName: null, debit: null, credit: null,
};
const emptyGst: GstMapping = {
  source: "FROM_SHEET", taxLayout: "LONG",
  cgst: null, sgst: null, igst: null, cess: null,
  rateGroups: [], rateColumn: null, flatRate: null, interstateColumn: null,
};
const emptyLedgers: LedgerMapping = {
  primaryLedgerId: null, cgstLedgerId: null, sgstLedgerId: null, igstLedgerId: null,
  cessLedgerId: null, roundOffLedgerId: null, discountLedgerId: null, perRateLedgerIds: {},
};
const sheetMapping: SheetMapping = {
  docType: "SALE",
  itemMode: "WITHOUT_ITEM",
  headerRowIndex: 0,
  fields: emptyFields,
  gst: emptyGst,
  ledgers: emptyLedgers,
};

describe("saveTemplate", () => {
  it("upserts on the schema's natural key and fingerprints the headers", async () => {
    const { prisma, calls } = fakeDb([]);
    const saved = await saveTemplate(prisma, {
      userId: "USER",
      clientId: "CLIENT_A",
      name: "Acme monthly sales",
      docType: "SALE",
      itemMode: "WITHOUT_ITEM",
      headers: SHEET_HEADERS,
      mapping: sheetMapping,
    });
    const call = calls.upsert.mock.calls[0][0];
    expect(call.where.userId_clientId_docType_headerFingerprint).toEqual({
      userId: "USER",
      clientId: "CLIENT_A",
      docType: "SALE",
      headerFingerprint: SHEET_FINGERPRINT,
    });
    expect(saved.headerFingerprint).toBe(SHEET_FINGERPRINT);
  });

  it("treats a re-save as a vote, the way rememberMapping does", async () => {
    const { prisma, calls } = fakeDb([]);
    await saveTemplate(prisma, {
      userId: "USER", clientId: "CLIENT_A", name: "n", docType: "SALE",
      itemMode: "WITHOUT_ITEM", headers: SHEET_HEADERS, mapping: sheetMapping,
    });
    const call = calls.upsert.mock.calls[0][0];
    expect(call.create.hitCount).toBe(1);
    expect(call.update.hitCount).toEqual({ increment: 1 });
    expect(call.update.lastUsedAt).toBeInstanceOf(Date);
  });
});

describe("recordTemplateUse", () => {
  it("increments the counter and stamps the time", async () => {
    const { prisma, calls } = fakeDb([]);
    await recordTemplateUse(prisma, "t1");
    const call = calls.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "t1" });
    expect(call.data.hitCount).toEqual({ increment: 1 });
    expect(call.data.lastUsedAt).toBeInstanceOf(Date);
  });

  it("does nothing for a built-in, which has no row to update", async () => {
    const { prisma, calls } = fakeDb([]);
    await recordTemplateUse(prisma, "builtin:meesho-sales");
    expect(calls.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// applyTemplate
// ---------------------------------------------------------------------------

describe("applyTemplate", () => {
  const template = { headers: SHEET_HEADERS, mapping: sheetMapping };

  it("re-points a saved mapping when the columns have been reordered", () => {
    const reordered = ["Party Name", "Invoice No", "Invoice Date", "Total", "Taxable Value"];
    const applied = applyTemplate(template, reordered)!;
    expect(applied.fields.invoiceNumber).toBe(1);
    expect(applied.fields.date).toBe(2);
    expect(applied.fields.partyName).toBe(0);
    expect(applied.fields.taxable).toBe(4);
    expect(applied.fields.total).toBe(3);
  });

  it("survives a column inserted in the middle", () => {
    const inserted = ["Invoice No", "Invoice Date", "Salesman", "Party Name", "Taxable Value", "Total"];
    const applied = applyTemplate(template, inserted)!;
    expect(applied.fields.partyName).toBe(3);
    expect(applied.fields.total).toBe(5);
  });

  it("matches headers that differ only in punctuation and case", () => {
    const applied = applyTemplate(template, ["INVOICE_NO.", "invoice date", "party name", "taxable value", "total"])!;
    expect(applied.fields.invoiceNumber).toBe(0);
    expect(applied.fields.total).toBe(4);
  });

  it("refuses rather than returning a mapping with most fields nulled", () => {
    expect(applyTemplate(template, ["Something", "Else", "Entirely"])).toBeNull();
  });

  it("re-points the tax columns and the rate groups too", () => {
    const wideTemplate = {
      headers: ["Inv", "5% Taxable", "5% CGST", "18% Taxable", "18% CGST"],
      mapping: {
        ...sheetMapping,
        fields: { ...emptyFields, invoiceNumber: 0, date: null, partyName: null, taxable: null, total: null },
        gst: {
          ...emptyGst,
          taxLayout: "WIDE" as const,
          rateGroups: [
            { rate: 5, taxable: 1, cgst: 2, sgst: null, igst: null },
            { rate: 18, taxable: 3, cgst: 4, sgst: null, igst: null },
          ],
        },
      },
    };
    const applied = applyTemplate(wideTemplate, ["18% Taxable", "18% CGST", "Inv", "5% Taxable", "5% CGST"])!;
    expect(applied.gst.rateGroups[0]).toMatchObject({ rate: 5, taxable: 3, cgst: 4 });
    expect(applied.gst.rateGroups[1]).toMatchObject({ rate: 18, taxable: 0, cgst: 1 });
  });
});

// ---------------------------------------------------------------------------
// Built-ins
// ---------------------------------------------------------------------------

describe("built-in templates", () => {
  it("ships the five vendors whose headers the docs actually give", () => {
    expect(BUILTIN_TEMPLATES.map((t) => t.sourceKey).sort()).toEqual([
      "ajio-sales",
      "choice-broker-purchase",
      "groww-purchase",
      "meesho-sales",
      "nj-india-invest-purchase",
    ]);
  });

  it("ships no Zerodha template, because neither Zerodha article lists its headers", () => {
    expect(BUILTIN_TEMPLATES.some((t) => t.sourceKey.includes("zerodha"))).toBe(false);
  });

  it("cites the FAQ each mapping was taken from", () => {
    for (const template of BUILTIN_TEMPLATES) {
      expect(template.source).toMatch(/^faqs\/.+\.md$/);
      expect(template.headers.length).toBeGreaterThan(3);
    }
  });

  it("recognises a raw Meesho export by fingerprint", () => {
    const meesho = findBuiltinTemplate("meesho-sales")!;
    const matches = matchBuiltinTemplates(meesho.headers, "SALE");
    expect(matches[0].templateId).toBe("builtin:meesho-sales");
    expect(matches[0].score).toBe(0.88);
    expect(builtinFingerprint(meesho)).not.toBe(builtinPreparedFingerprint(meesho));
  });

  it("recognises the prepared sheet the guide asks the accountant to produce", () => {
    const meesho = findBuiltinTemplate("meesho-sales")!;
    const prepared = [...meesho.headers, ...meesho.addedHeaders];
    const matches = matchBuiltinTemplates(prepared, "SALE");
    expect(matches[0].templateId).toBe("builtin:meesho-sales");
    expect(matches[0].missingHeaders).toEqual([]);
  });

  it("tells the accountant which column is still missing", () => {
    const meesho = findBuiltinTemplate("meesho-sales")!;
    const matches = matchBuiltinTemplates(meesho.headers, "SALE");
    expect(matches[0].missingHeaders).toEqual(["Sales Ledger"]);
  });

  it("still recognises a file with one column renamed", () => {
    const ajio = findBuiltinTemplate("ajio-sales")!;
    const renamed = ajio.headers.map((h) => (h === "Base Price" ? "Basic Price" : h));
    const matches = matchBuiltinTemplates(renamed, "SALE");
    expect(matches[0].templateId).toBe("builtin:ajio-sales");
    expect(matches[0].missingHeaders).toContain("Base Price");
  });

  it("does not claim an unrelated sheet", () => {
    expect(matchBuiltinTemplates(["Invoice No", "Date", "Party", "Taxable", "Total"])).toEqual([]);
  });

  it("keeps a built-in below a learned exact match", () => {
    const [builtin] = matchBuiltinTemplates(findBuiltinTemplate("groww-purchase")!.headers);
    expect(builtin.score).toBeLessThan(1);
    expect(isBuiltinTemplateId(builtin.templateId)).toBe(true);
  });

  it("turns a Groww export into a working mapping", () => {
    const groww = findBuiltinTemplate("groww-purchase")!;
    const headers = [...groww.headers, ...groww.addedHeaders];
    const mapping = builtinToMapping(groww, headers)!;
    expect(mapping.docType).toBe("PURCHASE");
    expect(mapping.itemMode).toBe("WITH_ITEM");
    expect(headers[mapping.fields.itemName!]).toBe("Stock name");
    expect(headers[mapping.fields.invoiceNumber!]).toBe("ISIN");
    expect(headers[mapping.fields.date!]).toBe("Execution date and time");
    expect(headers[mapping.fields.quantity!]).toBe("Quantity");
    expect(headers[mapping.fields.rate!]).toBe("Price");
    expect(headers[mapping.fields.partyName!]).toBe("Party Name");
  });

  it("turns the AJIO table into a mapping, invoice number and all", () => {
    const ajio = findBuiltinTemplate("ajio-sales")!;
    const headers = [...ajio.headers, ...ajio.addedHeaders];
    const mapping = builtinToMapping(ajio, headers)!;
    expect(headers[mapping.fields.invoiceNumber!]).toBe("Seller Invoice No");
    expect(headers[mapping.fields.date!]).toBe("Cust Invoice Date");
    expect(headers[mapping.fields.amount!]).toBe("Base Price");
    expect(headers[mapping.fields.partyName!]).toBe("Seller Name");
  });

  it("keeps the Choice Broker typo, because that is the column the file has", () => {
    const choice = findBuiltinTemplate("choice-broker-purchase")!;
    expect(choice.addedHeaders).toContain("Suplier invoice number");
    const headers = [...choice.headers, ...choice.addedHeaders];
    const mapping = builtinToMapping(choice, headers)!;
    expect(headers[mapping.fields.invoiceNumber!]).toBe("Suplier invoice number");
  });

  it("gives no column to two fields, except where the vendor's own table does", () => {
    for (const template of BUILTIN_TEMPLATES) {
      const headers = [...template.headers, ...template.addedHeaders];
      const mapping = builtinToMapping(template, headers)!;
      const taken = Object.values(mapping.fields).filter((v): v is number => v !== null);
      // Meesho is the one deliberate overlap: their table sends hsn_code to
      // "Name of Item", and a Meesho sheet has no product name column at all,
      // so the HSN is both the item's identity and its HSN.
      const pinnedTwice = Object.values(template.fields).length - new Set(Object.values(template.fields)).size;
      expect(new Set(taken).size).toBe(taken.length - pinnedTwice);
    }
  });

  it("returns null when none of the template's columns are present", () => {
    const meesho = findBuiltinTemplate("meesho-sales")!;
    expect(builtinToMapping(meesho, ["a", "b", "c"])).toBeNull();
  });
});
