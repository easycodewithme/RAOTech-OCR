/**
 * One place that decides how a number or a date is written on screen.
 *
 * Before this, eight separate `money()` helpers produced four different
 * results for the same rupee value — `₹1,23,456`, `₹1,23,456.00`, a bare
 * `1,23,456` — and five date helpers disagreed about what a date looks like,
 * including one bare `toLocaleString()` that renders `8/29/2026` on a browser
 * set to US English. A firm owner comparing two screens should not have to
 * work out whether the two numbers are the same number.
 *
 * These helpers are deliberately pure and dependency-free so a Server
 * Component, a Client Component and a test can all call them and agree.
 */

/**
 * Every format here is anchored to IST rather than the browser's zone.
 *
 * A voucher date is a fact about a set of books kept in India, not about where
 * the person looking at it happens to be sitting. Prisma hands back UTC
 * instants; rendering those in a browser set to, say, US Central would move a
 * 1 April voucher back to 31 March — across a financial year boundary, and
 * across a GST return period. Pinning the zone also makes the server render and
 * the client render produce the same string, so there is no hydration mismatch.
 */
const BOOKS_TIME_ZONE = "Asia/Kolkata";

/**
 * `en-IN` for numbers because Indian grouping is lakh/crore, not thousands:
 * 1,23,456 — not 123,456. An accountant reads the comma positions to size a
 * number at a glance, and Western grouping breaks that read.
 */
const IN_LOCALE = "en-IN";

/**
 * `en-GB` for dates because it yields `29 Aug 2026` — day first, month spelled
 * out. Day-first matches how dates are written and spoken in India, and the
 * spelled-out month removes the DD/MM vs MM/DD ambiguity that makes 03/04/2026
 * unreadable without knowing who wrote it.
 */
const DATE_LOCALE = "en-GB";

// Intl formatters are expensive to construct and cheap to reuse. A portfolio
// table calls these once per cell, so they are built once per process.
const MONEY_WITH_PAISE = new Intl.NumberFormat(IN_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const MONEY_WHOLE = new Intl.NumberFormat(IN_LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const COUNT = new Intl.NumberFormat(IN_LOCALE, { maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat(DATE_LOCALE, {
  timeZone: BOOKS_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const TIME = new Intl.DateTimeFormat(DATE_LOCALE, {
  timeZone: BOOKS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** What a helper accepts. Prisma gives Dates, JSON gives strings, both happen. */
export type DateInput = Date | string | number | null | undefined;

/**
 * Some ICU builds separate date parts with narrow no-break spaces, which look
 * identical on screen but break string comparison in tests and in CSV exports.
 * Normalising them keeps the output byte-stable across Node versions.
 */
function normalizeSpaces(s: string): string {
  return s.replace(/[\u202f\u00a0]/g, " ");
}

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface MoneyOptions {
  /**
   * Show paise. Defaults to `true`: in a ledger, two paise are the difference
   * between a voucher that balances and one Tally rejects, so hiding them by
   * default would hide the thing most worth seeing. Summary tiles that want a
   * headline figure pass `{ paise: false }` explicitly.
   */
  paise?: boolean;
  /** Prefix `₹`. Off for spreadsheet cells and inputs, on everywhere else. */
  symbol?: boolean;
}

/**
 * A rupee amount, Indian-grouped, with the precision stated at the call site.
 *
 * Negative amounts read `-₹1,234.00` rather than `₹-1,234.00`: the minus
 * belongs to the quantity, and putting it before the symbol is how it appears
 * on every statement a CA firm already handles.
 */
export function formatMoney(
  value: number | null | undefined,
  { paise = true, symbol = true }: MoneyOptions = {}
): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const body = (paise ? MONEY_WITH_PAISE : MONEY_WHOLE).format(Math.abs(n));
  const sign = n < 0 ? "-" : "";
  return `${sign}${symbol ? "₹" : ""}${body}`;
}

/**
 * A plain count — vouchers, invoices, stock items — with Indian grouping and
 * no currency symbol.
 *
 * Kept separate from `formatMoney` on purpose: several screens were passing
 * voucher counts through a helper named `money()`, and the day someone gave
 * that helper a `₹` prefix, "3 drafts" would have started reading as a rupee
 * amount.
 */
export function formatCount(value: number | null | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return COUNT.format(n);
}

/**
 * `29 Aug 2026`. Unparseable or missing values render as an em dash rather
 * than "Invalid Date", which is the kind of string that ends up in a client's
 * exported report.
 */
export function formatDate(value: DateInput, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return normalizeSpaces(DATE.format(d));
}

/**
 * `29 Aug 2026, 14:05`. Twenty-four hour because an audit trail entry should
 * not depend on the reader noticing an am/pm, and because this is how a Tally
 * sync log is read — in order, at a glance.
 */
export function formatDateTime(value: DateInput, fallback = "—"): string {
  const d = toDate(value);
  if (!d) return fallback;
  return `${normalizeSpaces(DATE.format(d))}, ${normalizeSpaces(TIME.format(d))}`;
}

/**
 * "just now" / "12m ago" / "5h ago" / "3d ago", falling back to an absolute
 * date past a month.
 *
 * The cutoff exists because relative time stops being informative once it is
 * large: "47d ago" makes a reader do arithmetic, while "12 Jul 2026" tells
 * them straight away which return period the last sync fell in.
 *
 * `now` is a parameter rather than an implicit `Date.now()` so a Server
 * Component can pass a stable anchor and a test can pin the clock.
 */
export function formatRelative(
  value: DateInput,
  now: number = Date.now(),
  fallback = "—"
): string {
  const d = toDate(value);
  if (!d) return fallback;

  const mins = Math.floor((now - d.getTime()) / 60000);
  // A clock skew between the server and the browser can put a timestamp a few
  // seconds into the future. "in 1m" would be alarming for something that just
  // happened, so anything not yet a minute old reads as "just now".
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(d, fallback);
}
