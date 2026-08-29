import { parseTallyImportResponse, type TallyImportResult } from "./importResult";

/**
 * Talk to a running Tally instance over its HTTP gateway.
 *
 * Where this can run
 * ------------------
 * Tally listens on the accountant's own machine (Help → Settings →
 * Connectivity → Client/Server Configuration; "Tally Prime Act" = Both, ODBC =
 * Yes, port anywhere in 9000-9999). That has a consequence worth stating
 * plainly: a serverless function on Vercel cannot reach it, and neither can a
 * browser on an https:// page — the request is blocked as mixed content and
 * Tally sends no CORS headers besides.
 *
 * So this module is written for a local caller: the desktop connector, or a
 * self-hosted instance on the same network. It is deliberately transport-only
 * and has no Next.js or Prisma imports, so the eventual desktop agent can
 * depend on it directly.
 */

export interface TallyGateway {
  /** Tally's own docs: set the host to "localhost" on the machine running it. */
  host: string;
  /** Configurable in Tally, 9000-9999. Not hardcoded — port mismatch is the
   *  single most common connection failure. */
  port: number;
  /** Tally can take a while on a large import. */
  timeoutMs?: number;
}

export const DEFAULT_GATEWAY: TallyGateway = {
  host: "localhost",
  port: 9000,
  timeoutMs: 120_000,
};

export function gatewayUrl(g: Pick<TallyGateway, "host" | "port">): string {
  return `http://${g.host}:${g.port}`;
}

function failure(message: string): TallyImportResult {
  return {
    ok: false,
    created: 0,
    altered: 0,
    deleted: 0,
    ignored: 0,
    combined: 0,
    cancelled: 0,
    errors: 0,
    exceptions: 0,
    lastVoucherId: null,
    lineErrors: [message],
    raw: "",
  };
}

/**
 * POST an Import Data envelope to Tally and read back its verdict.
 *
 * Never throws — a push that cannot reach Tally is a result the caller has to
 * record and show, not an exception to unwind through.
 */
export async function pushToTally(
  xml: string,
  gateway: TallyGateway = DEFAULT_GATEWAY
): Promise<TallyImportResult> {
  const url = gatewayUrl(gateway);
  const timeoutMs = gateway.timeoutMs ?? DEFAULT_GATEWAY.timeoutMs!;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      // Tally expects the raw envelope; it ignores charset negotiation.
      headers: { "Content-Type": "text/xml;charset=utf-8" },
      body: xml,
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      return failure(
        `Tally responded with HTTP ${res.status}. Check that a company is open and the gateway is enabled at ${url}.`
      );
    }

    return parseTallyImportResponse(text);
  } catch (err) {
    const e = err as { name?: string; code?: string; message?: string };

    if (e?.name === "AbortError") {
      return failure(
        `Tally did not respond within ${Math.round(timeoutMs / 1000)}s. A large import can be slow — try a smaller batch, or confirm Tally is not showing a modal dialog.`
      );
    }

    // The docs' most-reported symptom: "Not able to connect to Tally".
    return failure(
      `Could not reach Tally at ${url}. Confirm Tally is running with a company open, that Client/Server Configuration has "Tally Prime Act" set to Both, and that the port matches. (${e?.message ?? "connection failed"})`
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cheap liveness check before attempting a push, so the user gets "Tally isn't
 * reachable" up front instead of after a long export.
 */
export async function pingTally(
  gateway: TallyGateway = DEFAULT_GATEWAY
): Promise<{ reachable: boolean; message: string }> {
  const url = gatewayUrl(gateway);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    // Any well-formed request will do; Tally answers a bare envelope.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=utf-8" },
      body: "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER></ENVELOPE>",
      signal: controller.signal,
    });
    return res.ok
      ? { reachable: true, message: `Tally is reachable at ${url}.` }
      : { reachable: false, message: `Tally answered HTTP ${res.status} at ${url}.` };
  } catch {
    return {
      reachable: false,
      message: `No response from Tally at ${url}. Is Tally open with a company loaded, and is the port correct?`,
    };
  } finally {
    clearTimeout(timer);
  }
}
