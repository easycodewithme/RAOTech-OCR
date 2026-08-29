import { describe, it, expect } from "vitest";
import { narrationKey, normName } from "../normalize";
import { narrationKey as narrationKeyFromClassify, suggestLedgerFromNarrationMemory } from "../../bank/classify";

/**
 * The narration memory has one writer and one reader, and for a while they did
 * not agree on the key. The writer stored `normName(narration)`; the reader
 * asked for `narrationKey(narration)`. Nothing errored, nothing logged — the
 * feature simply never appeared to learn.
 *
 * These tests pin the two together.
 */
describe("narration memory key", () => {
  it("the reader's key function and the writer's are the same function", () => {
    expect(narrationKeyFromClassify).toBe(narrationKey);
  });

  /**
   * The reason the old mismatch was not cosmetic: for a real narration the two
   * normalisers produce genuinely different strings, so every single write
   * landed somewhere the reader never looked.
   */
  it("differs from plain normName on a real narration", () => {
    const narration = "UPI/DR/402913844/RELIANCE JIO/HDFC";
    expect(narrationKey(narration)).not.toBe(normName(narration));
    expect(narrationKey(narration)).toContain("reliance");
    expect(narrationKey(narration)).not.toContain("402913844");
    expect(narrationKey(narration)).not.toContain("upi");
  });

  /**
   * The same counterparty seen twice with different reference numbers is one
   * memory entry. This is what makes the memory worth having: a firm pays the
   * same landlord every month and the only thing that changes is the UTR.
   */
  it("collapses the same counterparty seen with different reference numbers", () => {
    expect(narrationKey("UPI/DR/402913844/RELIANCE JIO")).toBe(
      narrationKey("UPI/DR/778213991/RELIANCE JIO")
    );
  });

  /**
   * It does NOT collapse everything, and should not. `DR` and `CR` survive, so
   * a debit to a counterparty and a credit from the same one stay distinct
   * entries — which is right, since they usually mean different ledgers.
   */
  it("keeps the direction marker, so a debit and a credit do not share a key", () => {
    expect(narrationKey("UPI/DR/402913844/RELIANCE JIO")).not.toBe(
      narrationKey("UPI/CR/402913844/RELIANCE JIO")
    );
  });

  /** End to end: what a save writes is what a later suggestion reads. */
  it("a key written on save is the key a later suggestion finds", () => {
    const narration = "UPI/DR/402913844/RELIANCE JIO";
    // This is exactly what `rememberNarrationMappings` stores under.
    const memory = {
      [narrationKey(narration)]: {
        ledgerId: "L_TELECOM",
        ledgerName: "Telephone Expenses",
        hitCount: 3,
      },
    };

    const hit = suggestLedgerFromNarrationMemory("NEFT/778213991/RELIANCE JIO", memory);
    expect(hit?.ledgerId).toBe("L_TELECOM");
    expect(hit?.via).toBe("NARRATION_MEMORY");
  });

  it("has nothing to say about a narration that is all reference number", () => {
    expect(narrationKey("UPI/402913844/778213991")).toBe("");
  });
});
