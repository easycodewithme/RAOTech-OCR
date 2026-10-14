import { describe, it, expect } from "vitest";
import { cleanDate } from "../normalize";

describe("cleanDate parser", () => {
  it("parses 14-Sep-26 correctly into 2026", () => {
    const d = cleanDate("14-Sep-26");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September = index 8
    expect(d.getDate()).toBe(14);
  });

  it("parses 14-Sep-2026 correctly", () => {
    const d = cleanDate("14-Sep-2026");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(14);
  });

  it("parses 14/09/26 correctly into 2026", () => {
    const d = cleanDate("14/09/26");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(14);
  });

  it("parses 14.09.2026 correctly", () => {
    const d = cleanDate("14.09.2026");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(14);
  });
});
