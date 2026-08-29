import { describe, it, expect } from "vitest";
import {
  parseTallyImportResponse,
  describeImportResult,
} from "../importResult";

const response = (fields: Record<string, string | number>) =>
  `<RESPONSE>${Object.entries(fields)
    .map(([k, v]) => `<${k}>${v}</${k}>`)
    .join("")}</RESPONSE>`;

const SUCCESS = response({
  CREATED: 3,
  ALTERED: 0,
  DELETED: 0,
  LASTVCHID: 41,
  LASTMID: 0,
  COMBINED: 0,
  IGNORED: 0,
  ERRORS: 0,
  CANCELLED: 0,
  EXCEPTIONS: 0,
});

describe("parseTallyImportResponse — acceptance", () => {
  it("reads the counter block from a successful import", () => {
    const r = parseTallyImportResponse(SUCCESS);
    expect(r.ok).toBe(true);
    expect(r.created).toBe(3);
    expect(r.errors).toBe(0);
    expect(r.lastVoucherId).toBe("41");
  });

  it("counts an alter-only import as success", () => {
    const r = parseTallyImportResponse(response({ CREATED: 0, ALTERED: 2, ERRORS: 0, EXCEPTIONS: 0 }));
    expect(r.ok).toBe(true);
    expect(r.altered).toBe(2);
  });

  it("treats LASTVCHID of 0 as absent", () => {
    const r = parseTallyImportResponse(response({ CREATED: 1, LASTVCHID: 0, ERRORS: 0, EXCEPTIONS: 0 }));
    expect(r.lastVoucherId).toBeNull();
  });
});

describe("parseTallyImportResponse — rejection", () => {
  it("does not call it a success when Tally wrote nothing", () => {
    // The quiet failure: no errors reported, but nothing landed in the books.
    const r = parseTallyImportResponse(response({ CREATED: 0, ALTERED: 0, IGNORED: 4, ERRORS: 0, EXCEPTIONS: 0 }));
    expect(r.ok).toBe(false);
    expect(r.ignored).toBe(4);
  });

  it("fails when Tally reports errors even alongside a write", () => {
    const r = parseTallyImportResponse(response({ CREATED: 1, ERRORS: 2, EXCEPTIONS: 0 }));
    expect(r.ok).toBe(false);
    expect(r.errors).toBe(2);
  });

  it("fails on exceptions", () => {
    const r = parseTallyImportResponse(response({ CREATED: 1, ERRORS: 0, EXCEPTIONS: 1 }));
    expect(r.ok).toBe(false);
  });

  it("extracts every LINEERROR in order", () => {
    const xml = `<ENVELOPE><BODY><DATA>
      <LINEERROR>Ledger 'Acme Pvt Ltd' does not exist!</LINEERROR>
      <LINEERROR>The date is out of range! Can't import!</LINEERROR>
    </DATA></BODY></ENVELOPE>`;
    const r = parseTallyImportResponse(xml);
    expect(r.ok).toBe(false);
    expect(r.lineErrors).toEqual([
      "Ledger 'Acme Pvt Ltd' does not exist!",
      "The date is out of range! Can't import!",
    ]);
  });

  it("decodes XML entities inside a line error", () => {
    const xml = `<ENVELOPE><LINEERROR>Ledger &quot;R&amp;D&quot; not found</LINEERROR></ENVELOPE>`;
    expect(parseTallyImportResponse(xml).lineErrors[0]).toBe('Ledger "R&D" not found');
  });

  it("fails when a line error accompanies a clean counter block", () => {
    const r = parseTallyImportResponse(
      `${response({ CREATED: 1, ERRORS: 0, EXCEPTIONS: 0 })}<LINEERROR>Voucher number already exists</LINEERROR>`
    );
    expect(r.ok).toBe(false);
  });
});

describe("parseTallyImportResponse — hostile input", () => {
  it("does not throw on an empty body", () => {
    const r = parseTallyImportResponse("");
    expect(r.ok).toBe(false);
    expect(r.lineErrors[0]).toMatch(/empty response/i);
  });

  it("reports a non-Tally body rather than silently passing", () => {
    const r = parseTallyImportResponse("<html><body>502 Bad Gateway</body></html>");
    expect(r.ok).toBe(false);
    expect(r.lineErrors[0]).toMatch(/Unrecognised response/i);
    expect(r.lineErrors[0]).toContain("502 Bad Gateway");
  });

  it("keeps the raw payload for debugging", () => {
    expect(parseTallyImportResponse(SUCCESS).raw).toBe(SUCCESS);
  });
});

describe("describeImportResult", () => {
  it("summarises a success with its counts", () => {
    expect(describeImportResult(parseTallyImportResponse(SUCCESS))).toBe(
      "Tally accepted the import — 3 created."
    );
  });

  it("leads with Tally's own error text when there is one", () => {
    const r = parseTallyImportResponse("<ENVELOPE><LINEERROR>Ledger not found</LINEERROR></ENVELOPE>");
    expect(describeImportResult(r)).toBe("Ledger not found");
  });

  it("points at All Exceptions when Tally only gives counts", () => {
    const r = parseTallyImportResponse(response({ CREATED: 0, ERRORS: 1, EXCEPTIONS: 0 }));
    expect(describeImportResult(r)).toMatch(/All Exceptions/);
  });

  it("explains the silent no-op case", () => {
    const r = parseTallyImportResponse(response({ CREATED: 0, ALTERED: 0, ERRORS: 0, EXCEPTIONS: 0 }));
    expect(describeImportResult(r)).toMatch(/book period/);
  });
});
