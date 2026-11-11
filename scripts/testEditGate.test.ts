import { describe, expect, it } from "vitest";
import { editedTests } from "./testEditGate.mjs";

// #791 edited engine tests, asked "say if you object" afterwards and merged with no answer: the
// owner's OK on a changed test lived in prose alone.
describe("test-edit gate", () => {
  it("flags removed lines, a deleted test and a changed screenshot, never additions or new tests", () => {
    const engine = "packages/sound/src/engine.test.ts";
    const shot = "apps/web/e2e/topics.spec.ts-snapshots/row-phone-linux.png";
    expect(
      editedTests([
        { path: engine, status: "M", deleted: 3 },
        { path: "apps/web/e2e/gone.spec.ts", status: "D", deleted: 40 },
        { path: shot, status: "M", deleted: 0 },
        { path: "scripts/extended.test.ts", status: "M", deleted: 0 },
        { path: "scripts/fresh.test.ts", status: "A", deleted: 0 },
        { path: shot.replace("row", "new-row"), status: "A", deleted: 0 },
        { path: "packages/sound/src/engine.ts", status: "M", deleted: 9 },
      ]),
    ).toEqual([engine, "apps/web/e2e/gone.spec.ts", shot]);
  });
});
