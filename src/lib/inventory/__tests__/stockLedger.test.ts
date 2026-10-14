import { describe, it, expect } from "vitest";
import {
  buildStockLedger,
  buildPositions,
  directionOf,
  findExceptions,
  type StockMovementInput,
} from "../stockLedger";

/**
 * The engine behind the Inventory screens.
 *
 * These tests are where the accounting judgements live: which way a line moves
 * stock, what a sale is relieved at, and what happens when the data is wrong
 * in the ways real client data is wrong.
 */

const D = (iso: string) => new Date(iso);

function mv(over: Partial<StockMovementInput> & { voucherId: string }): StockMovementInput {
  return {
    voucherType: "PURCHASE",
    status: "POSTED",
    date: D("2026-04-01"),
    quantity: 1,
    debit: 0,
    credit: 0,
    ...over,
  };
}

describe("direction", () => {
  it("reads a debit stock line as goods coming in", () => {
    expect(directionOf({ debit: 100, credit: 0 })).toBe("IN");
  });

  it("reads a credit stock line as goods going out", () => {
    expect(directionOf({ debit: 0, credit: 100 })).toBe("OUT");
  });

  /**
   * The reason direction is not taken from voucherType. A sales return brings
   * goods back on a CREDIT_NOTE, and a purchase return sends them away on a
   * DEBIT_NOTE — the opposite of what the type name suggests to anyone
   * skim-reading. debit/credit gets both right without a special case.
   */
  it("brings stock back in on a sales return, and out on a purchase return", () => {
    const salesReturn = mv({
      voucherId: "cn", voucherType: "CREDIT_NOTE", debit: 500, quantity: 5,
    });
    const purchaseReturn = mv({
      voucherId: "dn", voucherType: "DEBIT_NOTE", credit: 200, quantity: 2,
    });
    expect(directionOf(salesReturn)).toBe("IN");
    expect(directionOf(purchaseReturn)).toBe("OUT");
  });
});

describe("running balance", () => {
  it("carries the opening balance through when nothing has moved", () => {
    const { rows, position } = buildStockLedger({ qty: 10, rate: 50 }, []);
    expect(rows).toHaveLength(0);
    expect(position.closingQty).toBe(10);
    expect(position.closingValue).toBe(500);
    expect(position.closingRate).toBe(50);
    expect(position.lastMovedAt).toBeNull();
  });

  it("treats a missing opening balance as nothing rather than as unknown", () => {
    const { position } = buildStockLedger({ qty: null, rate: null }, []);
    expect(position.openingQty).toBe(0);
    expect(position.openingValue).toBe(0);
    expect(position.closingRate).toBeNull();
  });

  it("adds purchases and subtracts sales", () => {
    const { position } = buildStockLedger({ qty: 0, rate: 0 }, [
      mv({ voucherId: "a", debit: 1000, quantity: 10, date: D("2026-04-01") }),
      mv({ voucherId: "b", voucherType: "SALE", credit: 400, quantity: 4, date: D("2026-04-05") }),
    ]);
    expect(position.inQty).toBe(10);
    expect(position.outQty).toBe(4);
    expect(position.closingQty).toBe(6);
  });

  it("replays in date order however the movements arrive", () => {
    const { rows } = buildStockLedger({ qty: 0, rate: 0 }, [
      mv({ voucherId: "later", voucherType: "SALE", credit: 100, quantity: 1, date: D("2026-05-01") }),
      mv({ voucherId: "earlier", debit: 1000, quantity: 10, date: D("2026-04-01") }),
    ]);
    expect(rows.map((r) => r.voucherId)).toEqual(["earlier", "later"]);
    expect(rows[0].balanceQty).toBe(10);
    expect(rows[1].balanceQty).toBe(9);
  });

  /**
   * Two vouchers on the same day must not swap places between page loads —
   * the running balance column is only readable if it is stable.
   */
  it("orders same-day movements deterministically", () => {
    const sameDay = [
      mv({ voucherId: "zzz", debit: 100, quantity: 1 }),
      mv({ voucherId: "aaa", debit: 100, quantity: 1 }),
    ];
    const first = buildStockLedger({ qty: 0, rate: 0 }, sameDay).rows.map((r) => r.voucherId);
    const second = buildStockLedger({ qty: 0, rate: 0 }, [...sameDay].reverse()).rows.map(
      (r) => r.voucherId
    );
    expect(first).toEqual(["aaa", "zzz"]);
    expect(second).toEqual(first);
  });

  it("does not mutate the array it was given", () => {
    const movements = [
      mv({ voucherId: "b", debit: 100, quantity: 1, date: D("2026-05-01") }),
      mv({ voucherId: "a", debit: 100, quantity: 1, date: D("2026-04-01") }),
    ];
    buildStockLedger({ qty: 0, rate: 0 }, movements);
    expect(movements.map((m) => m.voucherId)).toEqual(["b", "a"]);
  });
});

describe("weighted average valuation", () => {
  /**
   * The worked example: 10 @ 100 then 10 @ 140 averages to 120, so selling 5
   * relieves 600 and leaves 15 units worth 1800 — not 15 @ the latest 140, and
   * not FIFO's 500.
   */
  it("relieves a sale at the average of what is on hand", () => {
    const { rows, position } = buildStockLedger({ qty: 0, rate: 0 }, [
      mv({ voucherId: "p1", debit: 1000, quantity: 10, date: D("2026-04-01") }),
      mv({ voucherId: "p2", debit: 1400, quantity: 10, date: D("2026-04-02") }),
      mv({ voucherId: "s1", voucherType: "SALE", credit: 900, quantity: 5, date: D("2026-04-03") }),
    ]);

    expect(rows[2].balanceQty).toBe(15);
    expect(position.closingValue).toBeCloseTo(1800, 6);
    expect(position.closingRate).toBeCloseTo(120, 6);
    // The sale's own money value is what the customer paid; the stock relieved
    // is the cost. They are different numbers and both are kept.
    expect(rows[2].value).toBe(900);
    expect(position.outValue).toBeCloseTo(600, 6);
  });

  it("values the average before the issue, not after it", () => {
    const { position } = buildStockLedger({ qty: 10, rate: 100 }, [
      mv({ voucherId: "s", voucherType: "SALE", credit: 5000, quantity: 10, date: D("2026-04-02") }),
    ]);
    expect(position.closingQty).toBe(0);
    expect(position.closingValue).toBe(0);
    expect(position.closingRate).toBeNull();
  });

  it("derives a per-unit rate for a line that carries none", () => {
    const { rows } = buildStockLedger({ qty: 0, rate: 0 }, [
      mv({ voucherId: "a", debit: 1250, quantity: 10 }),
    ]);
    expect(rows[0].rate).toBe(125);
  });

  it("keeps the rate the line states rather than deriving one", () => {
    const { rows } = buildStockLedger({ qty: 0, rate: 0 }, [
      mv({ voucherId: "a", debit: 1250, quantity: 10, rate: 130 }),
    ]);
    expect(rows[0].rate).toBe(130);
  });
});

describe("the ways real data is wrong", () => {
  it("flags stock going out that never came in, and keeps counting", () => {
    const { rows, position } = buildStockLedger({ qty: 0, rate: 0 }, [
      mv({ voucherId: "s", voucherType: "SALE", credit: 300, quantity: 3 }),
    ]);
    expect(rows[0].warning).toBe("NEGATIVE_STOCK");
    expect(position.wentNegative).toBe(true);
    expect(position.closingQty).toBe(-3);
    // With no average available the line's own value is what leaves.
    expect(position.closingValue).toBe(-300);
  });

  it("moves value but not quantity for a line with an amount and no quantity", () => {
    const { rows, position } = buildStockLedger({ qty: 5, rate: 10 }, [
      mv({ voucherId: "a", debit: 250, quantity: null }),
    ]);
    expect(rows[0].warning).toBe("VALUE_WITHOUT_QTY");
    expect(position.closingQty).toBe(5);
    expect(position.closingValue).toBe(300);
    expect(position.valueOnlyLines).toBe(1);
  });

  it("treats a zero quantity the same as a missing one", () => {
    const { position } = buildStockLedger({ qty: 0, rate: 0 }, [
      mv({ voucherId: "a", debit: 100, quantity: 0 }),
    ]);
    expect(position.valueOnlyLines).toBe(1);
    expect(position.closingQty).toBe(0);
  });

  /**
   * Float drift: 0.1 + 0.2 - 0.3 leaves 5.55e-17, which renders as "0.00" but
   * compares as non-zero — enough to make an item that is exactly empty show a
   * closing rate computed by dividing by almost nothing.
   */
  it("settles to a clean zero rather than to float dust", () => {
    const { position } = buildStockLedger({ qty: 0, rate: 0 }, [
      mv({ voucherId: "a", debit: 10, quantity: 0.1 }),
      mv({ voucherId: "b", debit: 20, quantity: 0.2 }),
      mv({ voucherId: "c", voucherType: "SALE", credit: 30, quantity: 0.3, date: D("2026-04-09") }),
    ]);
    expect(position.closingQty).toBe(0);
    expect(position.closingRate).toBeNull();
  });

  it("takes a quantity's magnitude, so a negative one cannot flip the direction", () => {
    const { position } = buildStockLedger({ qty: 0, rate: 0 }, [
      mv({ voucherId: "a", debit: 100, quantity: -5 }),
    ]);
    expect(position.inQty).toBe(5);
    expect(position.closingQty).toBe(5);
  });
});

describe("buildPositions", () => {
  it("gives an item with no movement its opening balance", () => {
    const positions = buildPositions(
      [{ id: "i1", openingQty: 7, openingRate: 20 }],
      new Map()
    );
    expect(positions.get("i1")?.closingQty).toBe(7);
    expect(positions.get("i1")?.closingValue).toBe(140);
  });

  it("keeps each item's movements to itself", () => {
    const positions = buildPositions(
      [
        { id: "i1", openingQty: 0, openingRate: 0 },
        { id: "i2", openingQty: 0, openingRate: 0 },
      ],
      new Map([
        ["i1", [mv({ voucherId: "a", debit: 100, quantity: 10 })]],
        ["i2", [mv({ voucherId: "b", debit: 100, quantity: 2 })]],
      ])
    );
    expect(positions.get("i1")?.closingQty).toBe(10);
    expect(positions.get("i2")?.closingQty).toBe(2);
  });
});

describe("exceptions", () => {
  const base = {
    id: "i1",
    name: "Widget 10mm",
    unit: "Nos",
    tallySyncedAt: D("2026-04-01"),
    usedOnVouchers: 3,
  };
  const clean = new Map([
    [
      "i1",
      buildStockLedger({ qty: 0, rate: 0 }, [mv({ voucherId: "a", debit: 100, quantity: 1 })])
        .position,
    ],
  ]);

  it("says nothing about a healthy item", () => {
    expect(findExceptions([base], clean)).toEqual([]);
  });

  it("calls a missing unit blocking", () => {
    const [ex] = findExceptions([{ ...base, unit: null }], clean);
    expect(ex.kind).toBe("NO_UNIT");
    expect(ex.severity).toBe("BLOCKING");
  });

  /**
   * An unsynced master is routine on its own — the next push creates it. It is
   * only urgent once a voucher depends on it, so the same fact carries two
   * different severities and two different sentences.
   */
  it("grades an unsynced master by whether a voucher is waiting on it", () => {
    const idle = findExceptions(
      [{ ...base, tallySyncedAt: null, usedOnVouchers: 0 }],
      clean
    );
    expect(idle[0].severity).toBe("INFO");

    const blocking = findExceptions([{ ...base, tallySyncedAt: null }], clean);
    expect(blocking.find((e) => e.kind === "NOT_SYNCED")?.severity).toBe("BLOCKING");
  });

  it("reports negative stock against the item that went negative", () => {
    const negative = new Map([
      [
        "i1",
        buildStockLedger({ qty: 0, rate: 0 }, [
          mv({ voucherId: "s", voucherType: "SALE", credit: 100, quantity: 1 }),
        ]).position,
      ],
    ]);
    const ex = findExceptions([base], negative);
    expect(ex.some((e) => e.kind === "NEGATIVE_STOCK")).toBe(true);
  });

  it("puts blocking problems above warnings and notes", () => {
    const negative = new Map([
      [
        "i1",
        buildStockLedger({ qty: 0, rate: 0 }, [
          mv({ voucherId: "s", voucherType: "SALE", credit: 100, quantity: 1 }),
        ]).position,
      ],
    ]);
    const ex = findExceptions([{ ...base, unit: null }], negative);
    expect(ex[0].severity).toBe("BLOCKING");
    expect(ex.map((e) => e.severity)).toEqual([...ex.map((e) => e.severity)].sort());
  });
});
