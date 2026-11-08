import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPlayerRegistry,
  type GlyphDocument,
  isGenerated,
  loadGlyphs,
  PLAYER_REGISTRY_PATH,
  validateGlyphs,
} from "./buildGlyphs.js";

// The design system package owns glyphs.json and checks its source (D382 step 8); this checks
// what the player's registries are built from.
const doc = loadGlyphs();

function withGlyph(name: string, glyph: Partial<GlyphDocument["glyphs"][string]>): GlyphDocument {
  return {
    ...doc,
    glyphs: {
      [name]: { phosphor: "x", weight: "regular", targets: ["page"], d: "M0 0h24Z", ...glyph },
    },
  };
}

describe("glyph source", () => {
  // Prevents a design system bump whose glyphs.json this builder cannot read.
  it("is sound in the pinned design system", () => {
    expect(validateGlyphs(doc)).toEqual([]);
  });

  it("names what is wrong with a bad glyph", () => {
    expect(validateGlyphs(withGlyph("Bad-Name", {}))).toEqual(["Bad-Name: name is not camelCase"]);
    expect(validateGlyphs(withGlyph("ok", { phosphor: "Play Arrow" }))).toEqual([
      "ok: no Phosphor name",
    ]);
    expect(validateGlyphs(withGlyph("ok", { targets: [] }))).toEqual(["ok: no target"]);
    expect(validateGlyphs(withGlyph("ok", { d: "" }))).toEqual([
      "ok: path is missing or malformed",
    ]);
    // Markup or script can never ride along in a path.
    expect(validateGlyphs(withGlyph("ok", { d: 'M0 0"/><script>' }))).toEqual([
      "ok: path is missing or malformed",
    ]);
  });
});

describe("generated registries", () => {
  // Prevents the player drawing an old glyph after a design system bump changed it.
  it("matches the committed player registry once that file is generated", () => {
    const committed = readFileSync(PLAYER_REGISTRY_PATH, "utf8");
    // Until the player adopts this set its registry is hand-written, and this script leaves it be.
    if (!isGenerated(committed)) return;
    expect(committed).toBe(buildPlayerRegistry(doc));
  });
});
