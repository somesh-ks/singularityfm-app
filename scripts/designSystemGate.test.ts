import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWLISTS,
  allowlistAdditions,
  appBoundaryProblems,
  appSources,
  CROSS_APP_IMPORTS,
  checkDesignSystemPr,
  listEntries,
  SYSTEM_PATHS,
} from "./designSystemGate.mjs";

// The system lives in its own repository (D382 step 8); here the owner still decides what bends it.
describe("design-system gate", () => {
  it("lets a feature pull request through, and asks for the label on a change to who owns the system", () => {
    const feature = ["apps/web/src/pages/library.astro", "pnpm-lock.yaml"];
    expect(checkDesignSystemPr({ files: feature, labels: [] })).toEqual([]);
    const owners = [".github/CODEOWNERS"];
    expect(checkDesignSystemPr({ files: owners, labels: [] })).toHaveLength(1);
    expect(checkDesignSystemPr({ files: owners, labels: ["design-system"] })).toEqual([]);
  });

  // Without it any pull request names its own hand-made button bespoke, or its page's override of a
  // component, and the check that would have failed it passes (2026-11-04).
  it("asks for the label when a pull request adds to an allowlist, never when it only shrinks one", () => {
    const lists = ["BESPOKE_CONTROLS", "PAGE_OVERRIDES"];
    const file = (bespoke: string[], overrides: string[]) =>
      [
        "const BESPOKE_CONTROLS: [name: string, reason: string][] = [",
        ...bespoke,
        "];",
        "// A list it does not guard.",
        'const OTHER = ["kept-out"];',
        "const PAGE_OVERRIDES: string[] = [",
        ...overrides,
        "];",
      ].join("\n");
    const before = file(
      [
        '  ["create-fab", "the floating create button"],',
        '  [\n    "queue-fold",\n    "the queue\'s whole-row button: a row, not a control face",\n  ],',
        '  ["speed-btn", "the speed trigger"],',
      ],
      [
        '  "create.css: .create-view .field-input.create-title",',
        "  'menu.css: .menu-item[data-x=\"a\"]',",
      ],
    );
    const shrunk = file(
      [
        "  // Reworded, one gone.",
        '  ["create-fab", "the extended floating create button"],',
        '  [\n    "queue-fold",\n    "the queue\'s whole-row button: a row, not a control face",\n  ],',
      ],
      ["  'menu.css: .menu-item[data-x=\"a\"]',"],
    );
    expect(allowlistAdditions(before, shrunk, lists)).toEqual([]);

    const grown = file(
      [
        '  ["create-fab", "the floating create button"],',
        '  ["try-again", "the fallback card\'s retry"],',
        '  ["speed-btn", "the speed trigger"],',
      ],
      [
        '  "create.css: .create-view .field-input.create-title",',
        '  "create.css: .create-view .field-input.create-title",',
        "  'menu.css: .menu-item[data-x=\"a\"]',",
      ],
    );
    const added = allowlistAdditions(before, grown, lists);
    expect(added).toEqual([
      "BESPOKE_CONTROLS: try-again",
      "PAGE_OVERRIDES: create.css: .create-view .field-input.create-title",
    ]);
    const files = ["apps/web/src/styles/styles.test.ts"];
    const unlabelled = checkDesignSystemPr({ files, labels: [], added });
    expect(unlabelled).toHaveLength(1);
    expect(unlabelled[0]).toContain("try-again");
    const labelled = { files, labels: ["design-system"], added };
    expect(checkDesignSystemPr(labelled)).toEqual([]);
  });

  it("finds every list it guards, so a renamed or moved list cannot stop the guard unseen", () => {
    for (const [file, lists] of Object.entries(ALLOWLISTS)) {
      const text = readFileSync(join(import.meta.dirname, "..", file), "utf8");
      for (const list of lists) {
        expect(listEntries(text, list)?.length, `${file} has no ${list}`).toBeGreaterThan(0);
      }
    }
  });

  // The workflow runs only on its path filter, so a path missing there escapes the label rule.
  it("runs the workflow on every path it guards", () => {
    const workflow = readFileSync(
      join(import.meta.dirname, "../.github/workflows/design-system.yml"),
      "utf8",
    );
    const filter = [...workflow.matchAll(/^ {6}- (\S+)$/gm)].map(([, glob = ""]) => glob);
    const covered = (path: string) =>
      filter.some((glob) =>
        glob.endsWith("/**") ? path.startsWith(glob.slice(0, -2)) : glob === path,
      );
    expect([...SYSTEM_PATHS, ...Object.keys(ALLOWLISTS)].filter((path) => !covered(path))).toEqual(
      [],
    );
    // The boundary check reads every app.
    expect(filter).toContain("apps/**");
  });

  // The guide drew its page frame and search field from the reader's folder (D382 step 4e), so a
  // reader edit restyled the guide and nothing said so. An app takes shared parts from the package.
  it("fails an app that takes a part from another app's folder, and keeps the old reaches frozen", () => {
    const admin = "apps/admin/src/layouts/Shell.astro";
    const text = [
      'import "@singularityfm/design-system/styles/page-frame.css";',
      'import "../../../web/src/styles/settings.css";',
      'import { SUPPORTED_TIMEZONES } from "@singularityfm/core/time";',
      'import { x } from "@singularityfm/web/lib/x";',
    ].join("\n");
    // A stylesheet reaches by url() as well.
    expect(
      appBoundaryProblems(
        [
          {
            file: "apps/admin/src/styles/a.css",
            text: '@import url("../../../web/src/styles/b.css");',
          },
        ],
        [],
      ),
    ).toEqual(["apps/admin/src/styles/a.css: ../../../web/src/styles/b.css"]);
    expect(appBoundaryProblems([{ file: admin, text }], [])).toEqual([
      `${admin}: ../../../web/src/styles/settings.css`,
      `${admin}: @singularityfm/web/lib/x`,
    ]);
    const sources = appSources(join(import.meta.dirname, ".."));
    expect(sources.some(({ file }) => file.startsWith("apps/admin/src/"))).toBe(true);
    expect(appBoundaryProblems(sources)).toEqual([]);
    // A reach that is gone leaves the list, so it cannot come back unseen.
    expect(appBoundaryProblems(sources, []).sort()).toEqual([...CROSS_APP_IMPORTS].sort());
  });
});
