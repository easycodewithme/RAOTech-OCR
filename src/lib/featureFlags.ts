export const LOCAL_ONLY_ROUTE_PREFIXES = [
  "/pipeline",
  "/review",
  "/gst",
  "/reports",
  "/intake",
  "/tasks",
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
