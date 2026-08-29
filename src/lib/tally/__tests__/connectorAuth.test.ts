import { describe, it, expect, beforeEach } from "vitest";
import {
  TOKEN_PREFIX_LENGTH,
  bearerToken,
  formatPairingCode,
  generatePairingCode,
  hashToken,
  hashesMatch,
  looksLikeToken,
  mintToken,
  normalizeCode,
  rateLimitPairing,
  resetPairingRateLimit,
  tokenPrefixOf,
} from "../connectorAuth";

describe("mintToken", () => {
  it("produces rtc_ + 43 base64url characters", () => {
    const token = mintToken();
    expect(token.startsWith("rtc_")).toBe(true);
    expect(token.length).toBe(4 + 43);
    expect(looksLikeToken(token)).toBe(true);
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => mintToken()));
    expect(seen.size).toBe(500);
  });

  it("uses only URL-safe characters, so it survives a header and a JSON file", () => {
    for (let i = 0; i < 50; i++) {
      expect(mintToken()).toMatch(/^rtc_[A-Za-z0-9_-]+$/);
    }
  });
});

describe("hashToken", () => {
  it("is a stable sha256 hex digest", () => {
    const token = "rtc_abc";
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("separates two tokens that differ in one character", () => {
    expect(hashToken("rtc_aaa")).not.toBe(hashToken("rtc_aab"));
  });

  it("cannot be reversed to the prefix the settings page shows", () => {
    const token = mintToken();
    expect(hashToken(token)).not.toContain(tokenPrefixOf(token));
  });
});

describe("tokenPrefixOf", () => {
  it("keeps enough to name a token and not enough to use it", () => {
    const token = mintToken();
    const prefix = tokenPrefixOf(token);
    expect(prefix.length).toBe(TOKEN_PREFIX_LENGTH);
    expect(token.startsWith(prefix)).toBe(true);
    expect(looksLikeToken(prefix)).toBe(false);
  });
});

describe("hashesMatch", () => {
  it("accepts an identical digest and rejects anything else", () => {
    const a = hashToken("rtc_one");
    expect(hashesMatch(a, hashToken("rtc_one"))).toBe(true);
    expect(hashesMatch(a, hashToken("rtc_two"))).toBe(false);
  });

  it("returns false rather than throwing on a length mismatch", () => {
    // timingSafeEqual throws on unequal lengths; a truncated column must not 500.
    expect(hashesMatch(hashToken("x"), "deadbeef")).toBe(false);
  });
});

describe("looksLikeToken", () => {
  it("rejects everything that is not the minted shape", () => {
    expect(looksLikeToken("")).toBe(false);
    expect(looksLikeToken("Bearer rtc_x")).toBe(false);
    expect(looksLikeToken("rtc_short")).toBe(false);
    expect(looksLikeToken("abc_" + "a".repeat(43))).toBe(false);
    expect(looksLikeToken("rtc_" + "a".repeat(44))).toBe(false);
  });
});

describe("bearerToken", () => {
  const withHeader = (value: string) =>
    new Request("https://example.test/api/connector/jobs", {
      headers: { authorization: value },
    });

  it("reads the token out of a well-formed header", () => {
    expect(bearerToken(withHeader("Bearer rtc_abc"))).toBe("rtc_abc");
  });

  it("tolerates the casing and padding a Go client might send", () => {
    expect(bearerToken(withHeader("bearer   rtc_abc  "))).toBe("rtc_abc");
    expect(bearerToken(withHeader("BEARER rtc_abc"))).toBe("rtc_abc");
  });

  it("returns null for anything else", () => {
    expect(bearerToken(withHeader("Basic abc"))).toBeNull();
    expect(bearerToken(withHeader("rtc_abc"))).toBeNull();
    expect(
      bearerToken(new Request("https://example.test/api/connector/jobs"))
    ).toBeNull();
  });
});

describe("generatePairingCode", () => {
  it("is eight characters of the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      expect(generatePairingCode()).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
  });

  it("never emits a character that can be misread off a screen", () => {
    const joined = Array.from({ length: 500 }, generatePairingCode).join("");
    for (const banned of ["O", "0", "I", "1"]) {
      expect(joined).not.toContain(banned);
    }
  });
});

describe("normalizeCode", () => {
  it("accepts every way a user might type the same code", () => {
    for (const typed of [
      "K7M2-QX94",
      "k7m2-qx94",
      "k7m2 qx94",
      "K7M2QX94",
      " k7m2 - qx94 ",
      "k7m2.qx94",
    ]) {
      expect(normalizeCode(typed)).toBe("K7M2QX94");
    }
  });

  it("does not silently correct a character the alphabet excludes", () => {
    // A "0" typed for an "O" must fail to match rather than be guessed at —
    // which is the entire reason both are absent from the alphabet.
    expect(normalizeCode("K7M2-QX90")).toBe("K7M2QX90");
  });

  it("survives empty and non-string-ish input", () => {
    expect(normalizeCode("")).toBe("");
    expect(normalizeCode("----")).toBe("");
  });
});

describe("formatPairingCode", () => {
  it("round-trips through normalizeCode", () => {
    const code = generatePairingCode();
    expect(formatPairingCode(code)).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeCode(formatPairingCode(code))).toBe(code);
  });

  it("leaves a wrong-length value alone rather than mangling it", () => {
    expect(formatPairingCode("ABC")).toBe("ABC");
  });
});

describe("rateLimitPairing", () => {
  beforeEach(() => resetPairingRateLimit());

  it("allows a burst then blocks, per IP", () => {
    for (let i = 0; i < 10; i++) {
      expect(rateLimitPairing("1.2.3.4").allowed).toBe(true);
    }
    const blocked = rateLimitPairing("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);

    // A different address is unaffected — one noisy office must not lock out
    // every other pilot user.
    expect(rateLimitPairing("5.6.7.8").allowed).toBe(true);
  });

  it("re-opens once the window rolls over", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 11; i++) rateLimitPairing("1.2.3.4", t0);
    expect(rateLimitPairing("1.2.3.4", t0).allowed).toBe(false);
    expect(rateLimitPairing("1.2.3.4", t0 + 5 * 60_000 + 1).allowed).toBe(true);
  });
});
