import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NormalizedInvoice } from "@/lib/accounting/types";

/**
 * The two ingestion routes, checked at the layer where they were wrong.
 *
 * Every other suite here is a pure-function test, because until now everything
 * worth testing was pure. These three defects were not: cess was normalised
 * correctly and then dropped by the `prisma.invoice.create` call, the resume
 * guard was a `Set` lookup in the route, and the voucher failure was swallowed
 * by the route's own try/catch. None of that is reachable without standing the
 * handler up, so the database, Clerk and the voucher builder are stubbed and
 * the assertions are about what the route *asks the database to write* — which
 * is exactly what was wrong.
 */

type FindManyArgs = {
  where: {
    fileUrl?: { startsWith?: string };
    invoiceNumber?: string | { in: string[] } | null;
  };
  select?: Record<string, unknown>;
  take?: number;
};

/** What the mocked `NextResponse.json` hands back. */
type RouteResult = { status: number; body: Record<string, unknown> };

const h = vi.hoisted(() => {
  interface FakeInvoice {
    id: string;
    fileUrl: string;
    invoiceNumber: string | null;
    voucher: { id: string } | null;
    [k: string]: unknown;
  }

  const state = {
    invoices: [] as FakeInvoice[],
    created: [] as Record<string, unknown>[],
    voucherCalls: [] as { invoiceId: string }[],
    voucherThrows: null as Error | null,
    uploadUpdates: [] as Record<string, unknown>[],
    mappedRows: [] as unknown[],
    upload: null as Record<string, unknown> | null,
    nextId: 0,
  };

  const prisma = {
    excelUpload: {
      findFirst: vi.fn(async () => state.upload),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.uploadUpdates.push(data);
        return data;
      }),
    },
    ledger: { findMany: vi.fn(async () => []) },
    tallyCompany: { findUnique: vi.fn(async () => null) },
    invoice: {
      findMany: vi.fn(async (args: FindManyArgs) => {
        const w = args.where;
        const prefix = w.fileUrl?.startsWith;
        if (prefix) {
          return state.invoices
            .filter((i) => i.fileUrl.startsWith(prefix))
            .map((i) => ({ id: i.id, fileUrl: i.fileUrl, voucher: i.voucher }));
        }
        if (w.invoiceNumber && typeof w.invoiceNumber === "object") {
          const wanted = w.invoiceNumber.in;
          return state.invoices
            .filter((i) => i.invoiceNumber && wanted.includes(i.invoiceNumber))
            .map((i) => ({ invoiceNumber: i.invoiceNumber }));
        }
        // The save route's duplicate scan.
        const num = typeof w.invoiceNumber === "string" ? w.invoiceNumber : null;
        return state.invoices.filter((i) => !num || i.invoiceNumber === num);
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.created.push(data);
        const row: FakeInvoice = {
          id: `inv-${++state.nextId}`,
          fileUrl: String(data.fileUrl ?? ""),
          invoiceNumber: (data.invoiceNumber as string | null) ?? null,
          voucher: null,
          ...data,
        };
        state.invoices.push(row);
        return row;
      }),
    },
  };

  const createDraftVoucherForInvoice = vi.fn(async (_userId: string, invoiceId: string) => {
    state.voucherCalls.push({ invoiceId });
    if (state.voucherThrows) throw state.voucherThrows;
    const row = state.invoices.find((i) => i.id === invoiceId);
    const voucher = { id: `vch-${invoiceId}` };
    if (row) row.voucher = voucher;
    return voucher;
  });

  return { state, prisma, createDraftVoucherForInvoice };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

vi.mock("@/lib/accounting/createVoucher", () => ({
  createDraftVoucherForInvoice: h.createDraftVoucherForInvoice,
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "user_test" })),
  currentUser: vi.fn(async () => null),
}));

vi.mock("@/lib/clientContext", () => ({
  getActiveClient: vi.fn(async () => ({
    user: { id: "u1", clerkId: "user_test" },
    client: { id: "c1", gstin: null },
  })),
}));

vi.mock("@/lib/excel/rowStorage", () => ({
  decodeSheet: () => ({
    sheetName: "Sheet1",
    headerRowIndex: 0,
    headers: [],
    rows: [],
    droppedRowIndexes: [],
    totalRowsScanned: 0,
  }),
}));

vi.mock("@/lib/excel/mapRows", () => ({
  mapRows: () => ({ rows: h.state.mappedRows }),
}));

// Imported after the mocks so the routes pick them up.
const { POST: commitPost } = await import("@/app/api/excel/uploads/[uploadId]/commit/route");
const { POST: savePost } = await import("@/app/api/invoices/save/route");

const MAPPING = {
  docType: "PURCHASE",
  itemMode: "WITHOUT_ITEM",
  headerRowIndex: 0,
  fields: {},
  gst: {},
  ledgers: {
    primaryLedgerId: "l-purchase",
    cgstLedgerId: "l-cgst",
    sgstLedgerId: "l-sgst",
    igstLedgerId: "l-igst",
    cessLedgerId: "l-cess",
    roundOffLedgerId: "l-round",
    discountLedgerId: null,
    perRateLedgerIds: {},
  },
};

function invoice(over: Partial<NormalizedInvoice> = {}): NormalizedInvoice {
  return {
    invoiceNumber: null,
    date: new Date("2026-04-01T00:00:00.000Z"),
    vendor: "Acme Traders",
    vendorGstin: null,
    customerName: null,
    customerGstin: null,
    subtotal: 1000,
    cgst: 90,
    sgst: 90,
    igst: 0,
    discount: 0,
    total: 1180,
    items: [],
    ...over,
  };
}

const mapped = (row: number, inv: NormalizedInvoice) => ({
  row,
  invoice: inv,
  issues: [],
  partyLedgerId: null,
});

function resetUpload() {
  h.state.upload = {
    id: "up1",
    userId: "u1",
    clientId: "c1",
    // READY, never COMMITTED: this is what a continuation sees, and it is the
    // state in which the route must not re-create anything.
    status: "READY",
    committedRows: 0,
    skippedRows: 0,
    mapping: MAPPING,
    rows: {},
  };
}

const runCommit = () =>
  commitPost({} as Request, {
    params: Promise.resolve({ uploadId: "up1" }),
  }) as unknown as Promise<RouteResult>;

beforeEach(() => {
  h.state.invoices = [];
  h.state.created = [];
  h.state.voucherCalls = [];
  h.state.voucherThrows = null;
  h.state.uploadUpdates = [];
  h.state.mappedRows = [];
  h.state.nextId = 0;
  resetUpload();
  vi.clearAllMocks();
});

describe("excel commit route — cess (REL-05)", () => {
  it("writes cess onto the invoice row and counts it in taxAmount", async () => {
    h.state.mappedRows = [
      mapped(2, invoice({ cgst: 90, sgst: 90, igst: 0, cess: 120, total: 1300 })),
    ];

    await runCommit();

    expect(h.state.created).toHaveLength(1);
    const row = h.state.created[0];
    expect(row.cess).toBe(120);
    // Every report and reconciliation reads taxAmount off this column; leaving
    // the cess out of it understated tax by exactly the cess.
    expect(row.taxAmount).toBe(300);
  });

  it("leaves cess null, and taxAmount unchanged, when the sheet has no cess column", async () => {
    h.state.mappedRows = [mapped(2, invoice())];

    await runCommit();

    expect(h.state.created[0].cess).toBeNull();
    expect(h.state.created[0].taxAmount).toBe(180);
  });
});

describe("excel commit route — resume (REL-09)", () => {
  it("does not re-create a row that has no invoice number when called twice", async () => {
    // Two blank-numbered rows: a journal or cash book, where nothing carries a
    // bill number. The old guard was `if (inv.invoiceNumber && ...)`, so these
    // were never deduped and every continuation created them again.
    h.state.mappedRows = [mapped(2, invoice()), mapped(3, invoice({ total: 2360 }))];

    const first = await runCommit();
    expect(h.state.created).toHaveLength(2);
    expect(first.body.committed).toBe(2);

    h.state.created = [];
    resetUpload();
    h.state.upload!.committedRows = 2;

    const second = await runCommit();
    expect(h.state.created).toHaveLength(0);
    expect(second.body.alreadyCommitted).toBe(2);
    expect(second.body.committed).toBe(2);
  });

  it("keys the marker per row, so two identical blank-numbered rows both post once", async () => {
    // Identical amounts, identical (absent) numbers: only the row index tells
    // them apart, which is why the marker is the row and not the content.
    h.state.mappedRows = [mapped(2, invoice()), mapped(3, invoice())];

    await runCommit();
    expect(h.state.created).toHaveLength(2);

    h.state.created = [];
    resetUpload();
    await runCommit();
    expect(h.state.created).toHaveLength(0);
  });

  it("finishes a row whose invoice was written but whose voucher was not", async () => {
    h.state.mappedRows = [mapped(2, invoice())];
    h.state.invoices.push({
      id: "inv-existing",
      fileUrl: "excel://up1#2",
      invoiceNumber: null,
      voucher: null,
    });

    const res = await runCommit();

    // No second invoice, and the missing voucher is built for the one that is
    // already there rather than the row being skipped forever.
    expect(h.state.created).toHaveLength(0);
    expect(h.state.voucherCalls).toEqual([{ invoiceId: "inv-existing" }]);
    expect(res.body.repaired).toBe(1);
    expect(res.body.committed).toBe(1);
  });

  it("still skips a numbered row that already exists from another source", async () => {
    h.state.mappedRows = [mapped(2, invoice({ invoiceNumber: "INV-7" }))];
    h.state.invoices.push({
      id: "inv-typed-by-hand",
      fileUrl: "scan.pdf",
      invoiceNumber: "INV-7",
      voucher: { id: "v9" },
    });

    const res = await runCommit();

    expect(h.state.created).toHaveLength(0);
    expect(res.body.skipped).toBe(1);
  });
});

describe("invoices/save route", () => {
  const body = (extracted: Record<string, unknown> = {}) => ({
    extractedData: {
      invoice_number: "INV-1",
      date: "01/04/2026",
      vendor: "Acme Traders",
      subtotal: 1000,
      cgst: 90,
      sgst: 90,
      igst: 0,
      tax: 180,
      total_amount: 1180,
      ...extracted,
    },
    fileName: "bill.pdf",
  });

  const runSave = (input: Record<string, unknown>) =>
    savePost({ json: async () => input } as unknown as Request) as unknown as Promise<RouteResult>;

  it("persists cess and adds it to taxAmount when the printed total excludes it (REL-05)", async () => {
    const res = await runSave(body({ cess: 120 }));

    expect(res.status).toBe(200);
    expect(h.state.created[0].cess).toBe(120);
    // The document printed tax=180, which reconciles to CGST+SGST on its own,
    // so the cess was plainly not in it.
    expect(h.state.created[0].taxAmount).toBe(300);
  });

  it("does not double-count a cess the printed tax total already includes", async () => {
    const res = await runSave(body({ cess: 120, tax: 300 }));

    expect(res.status).toBe(200);
    expect(h.state.created[0].cess).toBe(120);
    expect(h.state.created[0].taxAmount).toBe(300);
  });

  it("reports 207 and names the failure when the voucher cannot be created (REL-10)", async () => {
    h.state.voucherThrows = new Error("No purchase ledger for this client");

    const res = await runSave(body());

    // The invoice really did save, so this is not a 500; but the user is about
    // to look at a transactions list that will not contain it, so it is not a
    // clean 200 either.
    expect(res.status).toBe(207);
    expect(res.body.success).toBe(true);
    expect(res.body.partial).toBe(true);
    expect(res.body.voucherCreated).toBe(false);
    expect(res.body.voucherId).toBeNull();
    expect(res.body.voucherError).toBe("No purchase ledger for this client");
    expect(res.body.warning).toMatch(/Transactions/);
    expect(h.state.created).toHaveLength(1);
  });

  it("returns a clean 200 when both halves succeed", async () => {
    const res = await runSave(body());

    expect(res.status).toBe(200);
    expect(res.body.partial).toBe(false);
    expect(res.body.voucherCreated).toBe(true);
    expect(res.body.voucherError).toBeNull();
  });

  it("scopes the invoice to the userId getDbUser resolved, not a locally upserted row (REL-11)", async () => {
    await runSave(body());

    // The duplicated `prisma.user.upsert({ where: { email } })` this route used
    // to run is gone; there must be no user write here at all.
    expect((h.prisma as Record<string, unknown>).user).toBeUndefined();
    expect(h.state.created[0].userId).toBe("u1");
  });
});
