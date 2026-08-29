export const LOCAL_ONLY_ROUTE_PREFIXES = [
  "/pipeline",
  "/review",
  "/gst",
  "/reports",
  "/intake",
  "/tasks",
  /**
   * Not yet real. Every thread, group and message on this screen comes from
   * `communication/mockData.ts` — invented colleagues discussing invented
   * invoices. Harmless while it is being built; in front of a CA firm owner it
   * is the one screen that would make them doubt the rest of the product.
   *
   * Comes off this list the day it reads from the database.
   */
  "/communication",
];

export const LOCAL_ONLY_API_PREFIXES = [
  "/api/gst",
  "/api/intake",
  "/api/tasks",
  "/api/vouchers/auto-approve-high",
];

export function extraPagesEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_ENABLE_EXTRA_PAGES === "true" ||
    process.env.ENABLE_EXTRA_PAGES === "true"
  );
}
