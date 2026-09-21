import { describe, it, expect } from "vitest";
import { defaultLedgerForRole } from "../LedgerSelect";

/**
 * Where a ledger created inline from the review screen gets filed.
 *
 * These two strings end up as `<PARENT>` in the client's own TallyPrime, so a
 * wrong one is not a display bug — it is a master sitting under the wrong head
 * in somebody's books, usually found by their accountant weeks later.
 */

describe("party side", () => {
  it("files a party on a purchase as a creditor", () => {
    expect(defaultLedgerForRole("PARTY", "PURCHASE")).toEqual({
      group: "SUNDRY_CREDITORS",
      ledgerType: "PARTY",
    });
  });

  /**
   * The bug this function was extracted for. Every party was filed as a
   * creditor because the decision was made from the line role alone, and a
   * role cannot tell a customer from a supplier — so customers created from a
   * sales voucher landed under Sundry Creditors.
   */
  it("files a party on a sale as a debtor", () => {
    expect(defaultLedgerForRole("PARTY", "SALE")).toEqual({
      group: "SUNDRY_DEBTORS",
      ledgerType: "PARTY",
    });
  });

  /**
   * Returns follow the document they reverse, not the direction of the money.
   * A credit note is a sales return, so its party is still the customer.
   */
  it("keeps a credit note's party on the customer side", () => {
    expect(defaultLedgerForRole("PARTY", "CREDIT_NOTE").group).toBe("SUNDRY_DEBTORS");
  });

  it("keeps a debit note's party on the supplier side", () => {
    expect(defaultLedgerForRole("PARTY", "DEBIT_NOTE").group).toBe("SUNDRY_CREDITORS");
  });

  it("reads a receipt as money in from a customer, a payment as money out to a supplier", () => {
    expect(defaultLedgerForRole("PARTY", "RECEIPT").group).toBe("SUNDRY_DEBTORS");
    expect(defaultLedgerForRole("PARTY", "PAYMENT").group).toBe("SUNDRY_CREDITORS");
  });

  it("falls back to a creditor when the voucher is unknown", () => {
    expect(defaultLedgerForRole("PARTY").group).toBe("SUNDRY_CREDITORS");
    expect(defaultLedgerForRole("PARTY", "JOURNAL").group).toBe("SUNDRY_CREDITORS");
  });
});

describe("tax ledgers", () => {
  /**
   * `LedgerType` has no `TAX` member — only TAX_INPUT and TAX_OUTPUT — and the
   * create route casts the value straight to Prisma. Sending "TAX" was an
   * invalid enum value, so creating a tax ledger inline failed outright rather
   * than being filed wrongly.
   */
  it("never emits the TAX member that does not exist", () => {
    for (const role of ["CGST", "SGST", "IGST", "CESS", "TAX"]) {
      for (const v of ["PURCHASE", "SALE", undefined]) {
        expect(defaultLedgerForRole(role, v).ledgerType).not.toBe("TAX");
      }
    }
  });

  it("treats GST on a purchase as input credit and on a sale as a liability", () => {
    expect(defaultLedgerForRole("CGST", "PURCHASE")).toEqual({
      group: "DUTIES_AND_TAXES",
      ledgerType: "TAX_INPUT",
    });
    expect(defaultLedgerForRole("IGST", "SALE")).toEqual({
      group: "DUTIES_AND_TAXES",
      ledgerType: "TAX_OUTPUT",
    });
  });
});

describe("item lines", () => {
  it("files an item on a sale as revenue, not as cost", () => {
    expect(defaultLedgerForRole("ITEM", "SALE")).toEqual({
      group: "SALES_ACCOUNTS",
      ledgerType: "SALE",
    });
  });

  it("files an item on a purchase as cost", () => {
    expect(defaultLedgerForRole("ITEM", "PURCHASE")).toEqual({
      group: "PURCHASE_ACCOUNTS",
      ledgerType: "PURCHASE",
    });
  });
});

describe("everything else", () => {
  it("falls back to indirect expenses", () => {
    expect(defaultLedgerForRole("ROUND_OFF", "PURCHASE")).toEqual({
      group: "INDIRECT_EXPENSES",
      ledgerType: "EXPENSE",
    });
    expect(defaultLedgerForRole()).toEqual({
      group: "INDIRECT_EXPENSES",
      ledgerType: "EXPENSE",
    });
  });

  it("does not care about the case it is handed", () => {
    expect(defaultLedgerForRole("party", "sale").group).toBe("SUNDRY_DEBTORS");
  });
});
