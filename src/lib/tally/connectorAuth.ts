import crypto from "node:crypto";
import type { ConnectorDevice, PrismaClient } from "@prisma/client";

/**
 * Bearer-token authentication for the desktop connector.
 *
 * The desktop binary never holds a login. A token is bound to (user, machine)
 * and nothing else, which is what makes the two operations an accountant
 * actually performs safe: revoking a device stops it dead without disturbing
 * the Clerk session, and changing the password does not un-pair the desktop.
 *
 * Only sha256(token) is persisted. `tokenPrefix` exists so the settings page
 * can name a device's token — "rtc_8fK2…" — without the server ever being able
 * to reproduce the token itself.
 */

const TOKEN_SCHEME = "rtc_";

/** Enough of the plaintext to identify a token in a list, not enough to use it. */
export const TOKEN_PREFIX_LENGTH = 12;

/**
 * 32 symbols with O/0 and I/1 removed. Pairing codes are read off a screen and
 * typed into a Windows console by someone who is not looking at the screen while
 * they type, so the alphabet has to survive that. 256 is an exact multiple of
 * 32, which is why the raw bytes can be taken modulo the alphabet without
 * biasing the distribution.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

/** `rtc_` + 43 base64url characters, from 32 bytes of CSPRNG output. */
export function mintToken(): string {
  return TOKEN_SCHEME + crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenPrefixOf(token: string): string {
  return token.slice(0, TOKEN_PREFIX_LENGTH);
}

export function looksLikeToken(token: string): boolean {
  return /^rtc_[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * Compare two sha256 hex digests without leaking their difference in timing.
 *
 * The lookup itself is an indexed equality on `tokenHash`, so this is belt and
 * braces — but it is the one comparison in the request that decides whether a
 * caller is a paired device, and `timingSafeEqual` costs nothing here.
 */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Pull the token out of `Authorization: Bearer …`, tolerating case and padding. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^\s*Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

/**
 * Resolve the calling device, or null.
 *
 * Null covers every rejection case — no header, malformed token, unknown hash,
 * revoked device — because the connector's only correct response to any of them
 * is the same: stop polling and show "not paired". Telling it *which* kind of
 * unknown it hit would only tell an attacker which guesses were closer.
 */
export async function authenticateDevice(
  db: PrismaClient,
  req: Request
): Promise<ConnectorDevice | null> {
  const token = bearerToken(req);
  if (!token || !looksLikeToken(token)) return null;

  const tokenHash = hashToken(token);
  const device = await db.connectorDevice.findUnique({ where: { tokenHash } });
  if (!device) return null;
  if (!hashesMatch(device.tokenHash, tokenHash)) return null;
  if (device.revokedAt) return null;

  return device;
}

/** Eight characters of the unambiguous alphabet, displayed as `XXXX-XXXX`. */
export function generatePairingCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Reduce whatever the user typed to the canonical eight characters.
 *
 * The stored code is the normalised form, so `k7m2 qx94`, `K7M2-QX94` and
 * `k7m2qx94` all claim the same row. Nothing is corrected here — a `0` typed
 * for an `O` stays a `0` and fails to match, which is precisely why the
 * alphabet excludes both.
 */
export function normalizeCode(raw: string): string {
  return (raw ?? "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/** The display form. Only ever shown; never what is compared. */
export function formatPairingCode(code: string): string {
  const normalized = normalizeCode(code);
  if (normalized.length !== CODE_LENGTH) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/** Codes are single-use and short-lived; ten minutes is the protocol's TTL. */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Per-IP throttle for the one unauthenticated route in the protocol.
 *
 * In-process and therefore per-instance: on a multi-instance deployment the
 * effective limit is this many attempts per instance. That is deliberate — the
 * code space is 32^8 (~1.1e12) with a ten-minute window, so this exists to stop
 * a script hammering the route, not as the security boundary. Adding Redis for
 * it would buy nothing the TTL does not already buy.
 */
const PAIR_ATTEMPT_LIMIT = 10;
const PAIR_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const PAIR_BUCKET_CEILING = 10_000;

const pairAttempts = new Map<string, { count: number; resetAt: number }>();

export function rateLimitPairing(
  key: string,
  now = Date.now()
): { allowed: boolean; retryAfterSec: number } {
  // The map is only ever pruned on write, so a burst from many addresses cannot
  // pin memory indefinitely.
  if (pairAttempts.size >= PAIR_BUCKET_CEILING) {
    for (const [k, v] of pairAttempts) {
      if (v.resetAt <= now) pairAttempts.delete(k);
    }
    if (pairAttempts.size >= PAIR_BUCKET_CEILING) pairAttempts.clear();
  }

  const bucket = pairAttempts.get(key);
  if (!bucket || bucket.resetAt <= now) {
    pairAttempts.set(key, { count: 1, resetAt: now + PAIR_ATTEMPT_WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }

  bucket.count += 1;
  if (bucket.count > PAIR_ATTEMPT_LIMIT) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** Test seam: the limiter is module state, so a suite has to be able to reset it. */
export function resetPairingRateLimit() {
  pairAttempts.clear();
}

/**
 * Best-effort client address. Behind Vercel the only trustworthy value is
 * `x-forwarded-for`'s first hop; a direct hit has neither header, and all of
 * those collapse into one shared bucket, which is the conservative direction.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
