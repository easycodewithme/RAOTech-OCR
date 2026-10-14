import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelative,
} from "@/lib/format";

describe("formatMoney", () => {
  it("groups in lakhs, not thousands", () => {
    expect(formatMoney(123456.5)).toBe("₹1,23,456.50");
    expect(formatMoney(12345678)).toBe("₹1,23,45,678.00");
  });

  it("shows paise by default and drops them only when asked", () => {
    expect(formatMoney(1000)).toBe("₹1,000.00");
    expect(formatMoney(1000, { paise: false })).toBe("₹1,000");
  });

  it("puts the minus before the symbol", () => {
    expect(formatMoney(-1234)).toBe("-₹1,234.00");
  });

  it("omits the symbol when the caller is filling a cell", () => {
    expect(formatMoney(1234, { symbol: false })).toBe("1,234.00");
  });

  it("treats null, undefined and NaN as zero rather than printing NaN", () => {
    expect(formatMoney(null)).toBe("₹0.00");
    expect(formatMoney(undefined)).toBe("₹0.00");
    expect(formatMoney(Number.NaN)).toBe("₹0.00");
  });
});

describe("formatCount", () => {
  it("groups without a currency symbol", () => {
    expect(formatCount(1234567)).toBe("12,34,567");
    expect(formatCount(0)).toBe("0");
    expect(formatCount(null)).toBe("0");
  });
});

describe("formatDate", () => {
  it("renders DD MMM YYYY", () => {
    expect(formatDate(new Date("2026-08-29T08:35:00Z"))).toBe("29 Aug 2026");
  });

  it("accepts an ISO string as well as a Date", () => {
    expect(formatDate("2026-08-29T08:35:00Z")).toBe("29 Aug 2026");
  });

  it("keeps a UTC-midnight date on its own day in IST", () => {
    // The bug this guards: rendering in a browser west of UTC would move a
    // 1 April voucher back into the previous financial year.
    expect(formatDate("2026-04-01T00:00:00Z")).toBe("01 Apr 2026");
  });

  it("falls back rather than printing Invalid Date", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
    expect(formatDate(null, "never")).toBe("never");
  });
});

describe("formatDateTime", () => {
  it("renders a 24-hour IST time after the date", () => {
    expect(formatDateTime("2026-08-29T08:35:00Z")).toBe("29 Aug 2026, 14:05");
  });

  it("falls back on a missing value", () => {
    expect(formatDateTime(undefined)).toBe("—");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-08-29T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("reads as just now under a minute, including small clock skew", () => {
    expect(formatRelative(ago(10_000), now)).toBe("just now");
    expect(formatRelative(new Date(now + 5_000), now)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(formatRelative(ago(12 * 60_000), now)).toBe("12m ago");
    expect(formatRelative(ago(5 * 3_600_000), now)).toBe("5h ago");
    expect(formatRelative(ago(3 * 86_400_000), now)).toBe("3d ago");
  });

  it("switches to an absolute date once relative time stops being useful", () => {
    expect(formatRelative(ago(47 * 86_400_000), now)).toBe("13 Jul 2026");
  });

  it("falls back on a missing value", () => {
    expect(formatRelative(null, now, "never")).toBe("never");
  });
});
