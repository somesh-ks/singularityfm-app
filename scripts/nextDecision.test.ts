import { describe, expect, it } from "vitest";
import { nextDecision } from "./nextDecision.mjs";

describe("nextDecision", () => {
  // Bug: two sessions each numbered a decision from their own checkout and both took D157.
  // The number must come from every branch's entries, not from the checkout.
  it("takes the highest number on any branch, plus one", () => {
    const main = ["docs/decisions/entries/D385.md", "docs/decisions/entries/D386.md"];
    const other = ["docs/decisions/entries/D385.md", "docs/decisions/entries/D388.md"];
    expect(nextDecision([...main, ...other])).toBe("D389");
  });
});
