/**
 * Single place that knows how to reach the FastAPI OCR backend.
 *
 * The backend holds every extracted invoice and spends paid OCR credits, so it
 * authenticates callers with a shared secret. These server routes are its only
 * intended client — the key must never reach the browser, which is why this
 * module reads a non-`NEXT_PUBLIC_` env var and is imported only from route
 * handlers.
 */

export const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8001";

const BACKEND_API_KEY = process.env.BACKEND_API_KEY || "";

/** Auth headers for a backend call, merged over any caller-supplied headers. */
export function backendHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return BACKEND_API_KEY ? { ...extra, "X-API-Key": BACKEND_API_KEY } : { ...extra };
}

/**
 * `fetch` against the backend with auth applied.
 * `path` is root-relative, e.g. "/extract".
 */
export function backendFetch(path: string, init: RequestInit = {}) {
  const headers = backendHeaders(
    (init.headers as Record<string, string> | undefined) ?? {}
  );
  return fetch(`${BACKEND_URL}${path}`, { ...init, headers });
}
