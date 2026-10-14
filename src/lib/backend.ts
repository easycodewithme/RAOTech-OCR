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
/**
 * How long to wait on the backend before giving up.
 *
 * It runs on a free Render instance that spins down when idle; a measured cold
 * start is ~24s. Without a deadline this `fetch` simply hangs until the
 * platform kills the whole function, which surfaces as a blank screen with no
 * error — the reader is left thinking extraction silently produced nothing.
 *
 * 45s sits under the route's own `maxDuration = 60` so the timeout fires here,
 * where it can be explained, rather than in the platform where it cannot.
 */
const BACKEND_TIMEOUT_MS = 45_000;

/** Thrown when the backend did not answer in time, so callers can say why. */
export class BackendTimeoutError extends Error {
  constructor() {
    super(
      "The OCR service did not respond in time. It sleeps when idle and takes " +
        "around half a minute to wake — try again in a moment."
    );
    this.name = "BackendTimeoutError";
  }
}

export function backendFetch(path: string, init: RequestInit = {}) {
  const headers = backendHeaders(
    (init.headers as Record<string, string> | undefined) ?? {}
  );
  return fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers,
    // Caller-supplied signals win; this is only the default ceiling.
    signal: init.signal ?? AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  }).catch((e) => {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new BackendTimeoutError();
    }
    throw e;
  });
}
