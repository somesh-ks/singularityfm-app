import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_PART_FILES, repoRoot } from "./coverage";

// Prevents a renamed or moved reader file from dropping out of its part's definition, which would count
// the file as a use and miss every page that imports it, with no error (D382 step 7).
describe("Coverage's reader part files", () => {
  it("all exist", () => {
    const root = repoRoot(import.meta.dirname);
    const missing = Object.values(APP_PART_FILES)
      .flat()
      .filter((file) => !existsSync(join(root, file)));
    expect(missing).toEqual([]);
  });
});
