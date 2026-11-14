import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCss, loadTokens } from "@singularityfm/design-system/scripts/buildTokens";
import { describe, expect, it } from "vitest";
import { packageFile } from "./prototype/buildShared.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// apps/web has its own dash rule (apps/web/src/styles/styles.test.ts); this one covers what lies outside it.
describe("house rules for authored files", () => {
  // Built from code points so this file does not contain the characters it forbids.
  const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

  const roots = [
    "docs/design",
    "docs/specs",
    "scripts",
    "packages/sound/src",
    "apps/web/src/styles",
    "packages/contracts/src",
    "docs/prototype/sound-lab.html",
    "docs/prototype/ui-prototype.html",
  ];

  function files(path: string): string[] {
    const full = resolve(ROOT, path);
    const stats = statSync(full);
    if (stats.isFile()) return [full];
    return readdirSync(full).flatMap((name) => {
      if (name === "node_modules" || name === "screenshots") return [];
      return files(join(path, name));
    });
  }

  it("contains no em dashes or en dashes", () => {
    const offenders: string[] = [];
    for (const file of roots.flatMap(files)) {
      if (!/\.(ts|astro|css|json|md|html)$/.test(file)) continue;
      // Generated pages inline fonts as base64, which cannot contain these characters.
      const text = readFileSync(file, "utf8");
      if (DASHES.test(text)) offenders.push(file.replace(ROOT, ""));
    }
    expect(offenders).toEqual([]);
  });
});

// A status a reader sees is a strip, an empty screen, a toast or an inline field error (design.md).
// "Showing saved content" sat in the layout as a bare paragraph with role="status" from 1 Nov (D282)
// to 13 Nov, a fifth way to say a state, because nothing looked at where status text lives. A status
// element is anything with role="status" or role="alert" that is not screen-reader-only; each file
// that has some is listed with how many and why. Adding one is a PR reason, as a PAGE_OVERRIDES entry
// is. The strip's messages are lib/stripMessages.ts.
describe("where a status line may live", () => {
  const ALLOWED: Record<string, { count: number; reason: string }> = {
    "components/CreateForm.astro": { count: 2, reason: "inline form errors" },
    "components/EpisodeActions.astro": { count: 2, reason: "inline form errors" },
    "components/TopicsPanel.astro": { count: 4, reason: "inline field errors" },
    "components/SourceFilter.astro": { count: 1, reason: "a filter that found nothing, inline" },
    "pages/settings/blocked-outlets.astro": {
      count: 2,
      reason: "a filter that found nothing; a sheet's field error",
    },
    "pages/settings/downloads.astro": { count: 1, reason: "a filter that found nothing, inline" },
    "sheets/GenerateSheet.tsx": { count: 3, reason: "inline form errors" },
    "player/PlayerSurface.tsx": {
      count: 2,
      reason: "the controls did not load: moves to the strip with its own retry",
    },
    "scripts/settingsSaved.ts": { count: 1, reason: "an inline field note" },
    "scripts/topicsEditor.ts": { count: 1, reason: "an inline field note" },
  };
  const STATUS =
    /role=["'](?:status|alert)["']|setAttribute\(\s*["']role["']\s*,\s*["'](?:status|alert)["']/g;

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory())
        return /^(node_modules|e2e|testing|dev|fixtures)$/.test(name) ? [] : sources(full);
      return /\.(astro|tsx|ts)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
    });
  }

  it("holds no status text outside the strip, empty screen, toast or inline field errors", () => {
    const base = resolve(ROOT, "apps/web/src");
    const found: Record<string, number> = {};
    for (const file of sources(base)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(STATUS)) {
        const open = text.lastIndexOf("<", match.index);
        const tag = text.slice(open, text.indexOf(">", match.index) + 1);
        if (match[0].startsWith("role") && /sr-only/.test(tag)) continue;
        const key = file.slice(base.length + 1);
        found[key] = (found[key] ?? 0) + 1;
      }
    }
    const allowed = Object.fromEntries(Object.entries(ALLOWED).map(([k, v]) => [k, v.count]));
    expect(found).toEqual(allowed);
  });
});

// The prototype and the sound lab draw with the system's tokens from outside its package, so a token
// the system removes is caught here (D378 folded --color-on-surface-subtle), not in the package.
describe("the prototype stylesheets", () => {
  const foundations = readFileSync(packageFile("styles/foundations.css"), "utf8");
  const defined = new Set(
    [...`${buildCss(loadTokens())}\n${foundations}`.matchAll(/(--[\w-]+)\s*:/g)].map(
      (match) => match[1] ?? "",
    ),
  );

  it.each(["scripts/prototype/ui-prototype.css", "scripts/soundLab/sound-lab.css"])(
    "keeps %s on defined tokens",
    (file) => {
      const source = readFileSync(resolve(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const local = new Set(defined);
      for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) local.add(match[1] ?? "");
      // A reference with a fallback, such as var(--i, 0), is an input set by the caller.
      for (const match of source.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        expect(local.has(match[1] ?? ""), `${file}: ${match[1]} is not defined`).toBe(true);
      }
      expect(source, `${file}: !important`).not.toMatch(/!important/);
      expect(source, `${file}: transition: all`).not.toMatch(/transition:\s*all\b/);
      expect(source, `${file}: scale(0)`).not.toMatch(/scale\(\s*0\s*[),]/);
      expect(source, `${file}: ease-in`).not.toMatch(/\bease-in\b(?!-out)/);
    },
  );
});

// actions/checkout runs `git submodule foreach` when it removes its credentials, and that exits 128
// on a gitlink with no .gitmodules entry, so every deploy-due run failed after 5fb06f0c committed a
// local spec-kit clone that way (#803, 2026-11-12).
describe("the git index", () => {
  it("holds no gitlink (a nested repository) without a .gitmodules to name it", () => {
    // A git hook sets GIT_DIR and GIT_INDEX_FILE, which would point this at another index.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
    );
    const entries = execFileSync("git", ["ls-files", "--stage"], {
      cwd: ROOT,
      encoding: "utf8",
      env,
    });
    const gitlinks = entries
      .split("\n")
      .filter((line) => line.startsWith("160000 "))
      .map((line) => line.split("\t")[1]);
    if (readdirSync(ROOT).includes(".gitmodules")) return;
    expect(
      gitlinks,
      "a nested repository was added; use `git rm --cached` or add a submodule",
    ).toEqual([]);
  });
});
