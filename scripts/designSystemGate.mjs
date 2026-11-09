// The design system is a product with one owner (D237, D253). It lives in its own repository and the
// apps pin its published package (D382 step 8), so a system change is a pull request there. Here the
// owner still decides what bends it: an entry added to a list that excuses app code from a system
// check, and the files that say who owns the system, need the `design-system` label and his merge.
// The gate also keeps each app taking shared parts from the package, never from another app.
// Usage in CI: LABELS='["design-system"]' BASE=<sha> node scripts/designSystemGate.mjs
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "design-system";

/** What says who owns the system and how the apps draw it: a change needs the label. */
export const SYSTEM_PATHS = [
  ".github/CODEOWNERS",
  // The gate itself: its lists of what it guards and of the old cross-app reaches.
  "scripts/designSystemGate.mjs",
  ".claude/skills/feature/references/controls-guide.md",
];

/** An app's imports: the JS forms, CSS @import "x", and a stylesheet's url(x), which the first form misses. */
const APP_IMPORT = /(?:from|import)\s*\(?\s*["']([^"'\s]+)["']|url\(\s*["']?([^"')\s]+)["']?\s*\)/g;

/**
 * What one app still takes from another app's folder (D382 step 4e: the reader, the admin and the
 * guide each take a shared part from the package, never from another app). The guide takes nothing;
 * these are the admin's Health, Costs and Experiments pages, drawn with reader parts not yet in the
 * package (the toaster and its sheets, the settings rows),
 * the health checks' data both read, and the admin's session gate the reader's API checks. The list
 * only shrinks: a new reach fails, and so does an entry that no longer reaches.
 */
export const CROSS_APP_IMPORTS = [
  "apps/admin/src/layouts/Shell.astro: ../../../web/src/styles/settings.css",
  "apps/admin/src/layouts/Shell.astro: ../../../web/src/styles/manage.css",
  "apps/admin/src/layouts/Shell.astro: ../../../web/src/styles/health.css",
  "apps/admin/src/layouts/Shell.astro: ../../../web/src/styles/costs.css",
  "apps/admin/src/lib/pillars.ts: ../../../web/src/lib/healthRows",
  "apps/admin/src/pages/experiments.astro: ../../../web/src/sheets/Toaster",
  "apps/admin/src/pages/experiments.astro: ../../../web/src/styles/create-sheet.css",
  "apps/admin/src/pages/experiments.astro: ../../../web/src/styles/episode-actions.css",
  "apps/admin/src/pages/experiments.astro: ../../../web/src/styles/sheets.css",
  "apps/admin/src/pages/experiments.astro: ../../../web/src/styles/player.css",
  "apps/admin/src/pages/health.astro: ../../../web/src/lib/healthRows",
  "apps/admin/src/scripts/costsPage.ts: ../../../web/src/lib/brandMarks",
  "apps/admin/src/scripts/experiments.ts: ../../../web/src/scripts/pageLeaving",
  "apps/admin/src/scripts/experiments.ts: ../../../web/src/scripts/toastEvent",
  "apps/admin/src/scripts/healthPage.ts: ../../../web/src/lib/healthRows",
  "apps/admin/src/scripts/healthSummary.ts: ../../../web/src/lib/healthRows",
  "apps/web/e2e/slowStore.spec.ts: ../../admin/src/lib/experimentsApi",
  "apps/web/src/server/adminGuard.test.ts: ../../../admin/src/gate/session",
  "apps/web/src/server/adminGuard.ts: ../../../admin/src/gate/session",
];

const APP_FILE = /\.(?:ts|tsx|astro|mjs|js|css)$/;
const APP_SKIP = new Set(["node_modules", "dist", "test-results", "playwright-report"]);

/**
 * Each import in an app that reaches another app's folder or package (`@singularityfm/web`, `admin`),
 * as "file: specifier", leaving out the reaches `allowed` lists.
 */
export function appBoundaryProblems(sources, allowed = CROSS_APP_IMPORTS) {
  return sources.flatMap(({ file, text }) => {
    const app = file.split("/")[1];
    return [...text.matchAll(APP_IMPORT)].flatMap(([, quoted, linked]) => {
      const specifier = quoted ?? linked;
      const reach = `${file}: ${specifier}`;
      const target = specifier.startsWith(".")
        ? posix.join(posix.dirname(file), specifier.replace(/[?#].*$/, ""))
        : specifier;
      const other =
        /^apps\/([^/]+)\//.exec(target)?.[1] ??
        /^@singularityfm\/(web|admin)(?:\/|$)/.exec(specifier)?.[1];
      return other !== undefined && other !== app && !allowed.includes(reach) ? [reach] : [];
    });
  });
}

/** Every source file and stylesheet of the reader and the admin, as appBoundaryProblems reads them. */
export function appSources(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!APP_SKIP.has(entry.name) && !entry.name.startsWith(".")) walk(path);
      } else if (APP_FILE.test(entry.name))
        found.push({ file: path, text: readFileSync(join(root, path), "utf8") });
    }
  };
  for (const app of ["web", "admin"]) walk(`apps/${app}`);
  return found;
}

/**
 * The lists that excuse code from a design-system check, by the file that holds them. Any pull request
 * may shrink one; an entry added is a design decision (a control drawn by hand, a page bending a
 * component, an outlined control), so it needs the label and the owner's merge (2026-11-04: any pull
 * request could add a bespoke class and silence the button rule).
 */
export const ALLOWLISTS = {
  "apps/web/src/styles/styles.test.ts": [
    "SHARED_CONTROLS",
    "BESPOKE_CONTROLS",
    "OUTLINED_CONTROLS",
    "PAGE_OVERRIDES",
  ],
  // The controls still written by hand and the popovers built outside Menu (D382 step 4c moved them
  // out of the package, beside the apps they read).
  "scripts/systemUse.test.ts": ["NOT_YET_COMPONENTS", "BUILT_OWN"],
};

/**
 * The entries of the array a source text declares as `const <name> ... = [...]`: each string, or each
 * tuple's first string. Undefined when the text declares no such list.
 */
export function listEntries(text, name) {
  const head = new RegExp(`const ${name}\\b[^=]*=\\s*\\[`).exec(text);
  if (!head) return undefined;
  const entries = [];
  let depth = 1;
  let first = false;
  for (let at = head.index + head[0].length; at < text.length && depth > 0; at += 1) {
    const character = text[at];
    if (character === "/" && text[at + 1] === "/") {
      const end = text.indexOf("\n", at);
      at = end < 0 ? text.length : end;
    } else if (character === "[") {
      depth += 1;
      first = true;
    } else if (character === "]") {
      depth -= 1;
    } else if (character === '"' || character === "'" || character === "`") {
      let end = at + 1;
      while (end < text.length && text[end] !== character) end += text[end] === "\\" ? 2 : 1;
      if (depth === 1 || first) entries.push(text.slice(at + 1, end));
      first = false;
      at = end;
    }
  }
  return entries;
}

/** What a change adds to a file's lists, as "LIST: entry": each entry beyond as many as it held. */
export function allowlistAdditions(before, after, lists) {
  return lists.flatMap((list) => {
    const held = new Map();
    for (const entry of listEntries(before, list) ?? [])
      held.set(entry, (held.get(entry) ?? 0) + 1);
    return (listEntries(after, list) ?? []).flatMap((entry) => {
      const count = held.get(entry) ?? 0;
      held.set(entry, count - 1);
      return count > 0 ? [] : [`${list}: ${entry}`];
    });
  });
}

/**
 * The problems with a pull request, given its changed files, its labels and what it adds to the
 * allowlists. Empty means it may go on.
 */
export function checkDesignSystemPr({ files, labels, added = [] }) {
  if (labels.includes(LABEL)) return [];
  const touched = files.filter((file) => SYSTEM_PATHS.includes(file));
  const problems = [];
  if (touched.length > 0) {
    problems.push(
      `This pull request changes who owns the design system or how the apps draw it ` +
        `(${touched.join(", ")}), so it needs the "${LABEL}" label and the owner's merge.`,
    );
  }
  if (added.length > 0) {
    problems.push(
      `This pull request adds to the lists that excuse code from the design system's checks ` +
        `(${added.slice(0, 3).join("; ")}${added.length > 3 ? `; and ${added.length - 3} more` : ""}), ` +
        `which only the owner grows. Draw it with the system instead, or add the "${LABEL}" label for the owner's merge.`,
    );
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.env.BASE;
  const labels = JSON.parse(process.env.LABELS ?? "[]");
  if (!base) {
    console.error("BASE (the pull request's base commit) is required.");
    process.exit(2);
  }
  // CI checks out the pull request merged into the base as it is now, which can be newer than the
  // base commit the event names; the merge's first parent is that newer base, so diffing against it
  // lists only what the pull request changes. A local run (a feature branch that merged main has two
  // parents too, but its first is its own previous commit) compares against BASE instead.
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
  const merged =
    process.env.GITHUB_ACTIONS === "true" &&
    git("rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ").length === 3;
  const files = git("diff", "--name-only", ...(merged ? ["HEAD^1", "HEAD"] : [`${base}...HEAD`]))
    .split("\n")
    .filter(Boolean);
  const before = merged ? "HEAD^1" : base;
  const show = (rev, file) => {
    try {
      return git("show", `${rev}:${file}`);
    } catch {
      return "";
    }
  };
  const added = Object.entries(ALLOWLISTS)
    .filter(([file]) => files.includes(file))
    .flatMap(([file, lists]) => allowlistAdditions(show(before, file), show("HEAD", file), lists));
  const problems = checkDesignSystemPr({ files, labels, added });
  for (const reach of appBoundaryProblems(appSources(process.cwd()))) {
    problems.push(
      `${reach} takes a part from another app's folder. An app takes a shared part from the design system's package: move the part there (its own repository).`,
    );
  }
  for (const problem of problems) console.log(`::error::${problem}`);
  console.log(
    problems.length
      ? `design-system gate: ${problems.length} problem(s)`
      : `design-system gate passed (${files.length} files, labels: ${labels.join(", ") || "none"})`,
  );
  process.exit(problems.length ? 1 : 0);
}
