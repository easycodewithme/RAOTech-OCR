import { describe, it, expect } from "vitest";
import { encodeSheet, decodeSheet, applyEdits } from "../rowStorage";
import type { ParsedSheet } from "../types";

function makeSheet(rows: (string | number | null)[][]): ParsedSheet {
  return {
    sheetName: "Test",
    headerRowIndex: 0,
    headers: ["A", "B", "C"],
    rows,
    droppedRowIndexes: [],
    totalRowsScanned: rows.length,
  };
}

describe("applyEdits", () => {
  it("replaces cells at the given row index", () => {
    const sheet = makeSheet([
      ["INV-001", 100, "Vendor A"],
      ["INV-002", 200, "Vendor B"],
    ]);
    const result = applyEdits(sheet, [
      { row: 0, cells: ["INV-001-FIXED", 150, "Vendor A Corrected"] },
    ]);
    expect(result.rows[0]).toEqual(["INV-001-FIXED", 150, "Vendor A Corrected"]);
    expect(result.rows[1]).toEqual(["INV-002", 200, "Vendor B"]);
  });

  it("does not mutate the original sheet", () => {
    const sheet = makeSheet([["a", 1, null]]);
    const result = applyEdits(sheet, [{ row: 0, cells: ["b", 2, "x"] }]);
    expect(sheet.rows[0]).toEqual(["a", 1, null]);
    expect(result.rows[0]).toEqual(["b", 2, "x"]);
  });

  it("ignores out-of-range row indices", () => {
    const sheet = makeSheet([["a", 1, null]]);
    const result = applyEdits(sheet, [
      { row: -1, cells: ["bad", 0, null] },
      { row: 99, cells: ["bad", 0, null] },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual(["a", 1, null]);
  });

  it("applies multiple edits in order", () => {
    const sheet = makeSheet([
      ["r0", 0, null],
      ["r1", 1, null],
      ["r2", 2, null],
    ]);
    const result = applyEdits(sheet, [
      { row: 0, cells: ["r0-fixed", 10, "ok"] },
      { row: 2, cells: ["r2-fixed", 20, "ok"] },
    ]);
    expect(result.rows[0]).toEqual(["r0-fixed", 10, "ok"]);
    expect(result.rows[1]).toEqual(["r1", 1, null]);
    expect(result.rows[2]).toEqual(["r2-fixed", 20, "ok"]);
  });

  it("round-trips through encode/decode", () => {
    const sheet = makeSheet([["a", 1, null]]);
    const edited = applyEdits(sheet, [{ row: 0, cells: ["b", 2, "x"] }]);
    const encoded = encodeSheet(edited);
    const decoded = decodeSheet(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.rows[0]).toEqual(["b", 2, "x"]);
  });
});
