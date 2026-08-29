import { describe, it, expect } from "vitest";
import {
  mapItemMasters,
  mapLedgerMasters,
  suggestMasterMapping,
  type MasterFieldMapping,
} from "../masters";
import type { ParsedSheet } from "../types";

const sheet = (headers: string[], rows: unknown[][]): ParsedSheet => ({
  sheetName: "Sheet1",
  headerRowIndex: 0,
  headers,
  rows: rows as never,
  droppedRowIndexes: [],
  totalRowsScanned: rows.length + 1,
});

const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe("suggestMasterMapping", () => {
  it("reads a chart of accounts the way a firm writes one", () => {
    const m = suggestMasterMapping(
      ["Ledger Name", "Under", "GSTIN", "Opening Balance"],
      "LEDGER_MASTER"
    );
    expect(m.name).toBe(0);
    expect(m.group).toBe(1);
    expect(m.gstin).toBe(2);
    expect(m.openingBalance).toBe(3);
  });

  it("reads an item list", () => {
    const m = suggestMasterMapping(
      ["Item Name", "Unit", "HSN", "GST Rate", "Opening Qty"],
      "ITEM_MASTER"
    );
    expect(m.name).toBe(0);
    expect(m.unit).toBe(1);
    expect(m.hsnCode).toBe(2);
    expect(m.gstRate).toBe(3);
    expect(m.openingQty).toBe(4);
  });

  /**
   * "Name" matches "Unit Name" too, and on an item sheet that would put the
   * unit column in the name field and make every row an item called "Nos".
   */
  it("prefers the specific header over a bare 'name' match", () => {
    const m = suggestMasterMapping(["Unit Name", "Item Name"], "ITEM_MASTER");
    expect(m.name).toBe(1);
  });

  it("leaves a field null rather than guessing when nothing matches", () => {
    const m = suggestMasterMapping(["Col A", "Col B"], "LEDGER_MASTER");
    expect(m.name).toBeNull();
    expect(m.group).toBeNull();
  });
});

const LEDGER_MAP: MasterFieldMapping = {
  ...suggestMasterMapping(["Ledger Name", "Under", "GSTIN", "Opening Balance"], "LEDGER_MASTER"),
};

describe("mapLedgerMasters", () => {
  it("maps Tally's group names onto ours and derives the ledger type", () => {
    const r = mapLedgerMasters(
      sheet(
        ["Ledger Name", "Under", "GSTIN", "Opening Balance"],
        [
          ["Acme Traders", "Sundry Creditors", "27AAAPA1234A1Z5", "15000"],
          ["Rent", "Indirect Expenses", "", ""],
          ["HDFC Current", "Bank Accounts", "", "250000"],
        ]
      ),
      LEDGER_MAP
    );

    expect(r.committableCount).toBe(3);
    expect(r.rows[0].draft).toMatchObject({
      name: "Acme Traders",
      group: "SUNDRY_CREDITORS",
      ledgerType: "PARTY",
      gstin: "27AAAPA1234A1Z5",
      openingBalance: 15000,
    });
    expect(r.rows[1].draft).toMatchObject({ group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" });
    expect(r.rows[2].draft).toMatchObject({ group: "BANK_ACCOUNTS", ledgerType: "BANK" });
  });

  /**
   * An unrecognised group is a warning, not a refusal, and it lands somewhere
   * harmless. Current Assets is not a posting default anywhere in the app, so a
   * misfiled ledger shows up under an odd heading rather than quietly becoming
   * the default purchase account for every voucher.
   */
  it("warns rather than refuses on a group it does not know", () => {
    const r = mapLedgerMasters(
      sheet(["Ledger Name", "Under", "GSTIN", "Opening Balance"], [["Odd One", "Wibble", "", ""]]),
      LEDGER_MAP
    );
    expect(codes(r.rows[0])).toContain("UNKNOWN_GROUP");
    expect(r.rows[0].issues[0].severity).toBe("warning");
    expect(r.rows[0].draft!.group).toBe("CURRENT_ASSETS");
    expect(r.committableCount).toBe(1);
  });

  it("blocks a nameless row and a name repeated inside the sheet", () => {
    const r = mapLedgerMasters(
      sheet(
        ["Ledger Name", "Under", "GSTIN", "Opening Balance"],
        [["Acme", "Sundry Creditors", "", ""], ["", "Sundry Creditors", "", ""], ["ACME ", "Sundry Creditors", "", ""]]
      ),
      LEDGER_MAP
    );
    expect(codes(r.rows[1])).toContain("MISSING_NAME");
    expect(codes(r.rows[2])).toContain("DUPLICATE_IN_SHEET");
    expect(r.committableCount).toBe(1);
  });

  /** Re-uploading a chart to add a few ledgers is normal; it must not refuse. */
  it("treats a ledger the workspace already has as a skip, not a failure", () => {
    const r = mapLedgerMasters(
      sheet(["Ledger Name", "Under", "GSTIN", "Opening Balance"], [["Rent", "Indirect Expenses", "", ""]]),
      LEDGER_MAP,
      { existingNames: ["rent"] }
    );
    expect(codes(r.rows[0])).toContain("ALREADY_EXISTS");
    expect(r.rows[0].issues[0].severity).toBe("warning");
    expect(r.committableCount).toBe(1);
  });

  it("drops a malformed GSTIN rather than writing it onto the party", () => {
    const r = mapLedgerMasters(
      sheet(["Ledger Name", "Under", "GSTIN", "Opening Balance"], [["Acme", "Sundry Creditors", "NOTAGSTIN", ""]]),
      LEDGER_MAP
    );
    expect(codes(r.rows[0])).toContain("BAD_GSTIN");
    expect(r.rows[0].draft!.gstin).toBeNull();
  });
});

const ITEM_MAP = suggestMasterMapping(
  ["Item Name", "Unit", "HSN", "GST Rate", "Opening Qty", "Opening Rate"],
  "ITEM_MASTER"
);

describe("mapItemMasters", () => {
  it("maps an item list", () => {
    const r = mapItemMasters(
      sheet(
        ["Item Name", "Unit", "HSN", "GST Rate", "Opening Qty", "Opening Rate"],
        [["Widget 10mm", "Nos", "8471 9000", "18", "40", "125.50"]]
      ),
      ITEM_MAP
    );
    expect(r.committableCount).toBe(1);
    expect(r.rows[0].draft).toMatchObject({
      name: "Widget 10mm",
      unit: "Nos",
      hsnCode: "84719000",
      gstRate: 18,
      openingQty: 40,
      openingRate: 125.5,
    });
  });

  /**
   * The one refusal worth having here. Tally will not let a base unit change
   * once stock has moved against the item, so defaulting to "Nos" is not a
   * guess an accountant can take back later — it is a permanent wrong unit on
   * the client's master.
   */
  it("refuses an item with no unit instead of defaulting it", () => {
    const r = mapItemMasters(
      sheet(
        ["Item Name", "Unit", "HSN", "GST Rate", "Opening Qty", "Opening Rate"],
        [["Widget", "", "", "", "", ""]]
      ),
      ITEM_MAP
    );
    expect(codes(r.rows[0])).toContain("MISSING_UNIT");
    expect(r.rows[0].issues.find((i) => i.code === "MISSING_UNIT")!.severity).toBe("error");
    expect(r.committableCount).toBe(0);
    expect(r.rows[0].issues[0].message).toMatch(/base unit/i);
  });

  it("takes a numeric cell as a number without going through text", () => {
    const r = mapItemMasters(
      sheet(
        ["Item Name", "Unit", "HSN", "GST Rate", "Opening Qty", "Opening Rate"],
        [["Widget", "Nos", "", 18, 40, 125.5]]
      ),
      ITEM_MAP
    );
    expect(r.rows[0].draft).toMatchObject({ gstRate: 18, openingQty: 40, openingRate: 125.5 });
  });

  it("folds case and spacing when spotting a duplicate", () => {
    const r = mapItemMasters(
      sheet(
        ["Item Name", "Unit", "HSN", "GST Rate", "Opening Qty", "Opening Rate"],
        [["Widget 10mm", "Nos", "", "", "", ""], ["widget  10MM", "Nos", "", "", "", ""]]
      ),
      ITEM_MAP
    );
    expect(codes(r.rows[1])).toContain("DUPLICATE_IN_SHEET");
  });
});
