// The design system is a product with one owner (D237, D253). It lives in its own repository and the
// apps pin its published package (D382 step 8), so a system change is a pull request there. Here the
// owner still decides what bends it: an entry added to a list that excuses app code from a system
// check, and the files that say who owns the system, need the `design-system` label and his merge.
// Usage in CI: LABELS='["design-system"]' BASE=<sha> node scripts/designSystemGate.mjs
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "design-system";

/** What says who owns the system and how the apps draw it: a change needs the label. */
export const SYSTEM_PATHS = [
  ".github/CODEOWNERS",
  // The gate itself: its list of what it guards.
  "scripts/designSystemGate.mjs",
  ".claude/skills/feature/references/controls-guide.md",
];

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
  for (const problem of problems) console.log(`::error::${problem}`);
  console.log(
    problems.length
      ? `design-system gate: ${problems.length} problem(s)`
      : `design-system gate passed (${files.length} files, labels: ${labels.join(", ") || "none"})`,
  );
  process.exit(problems.length ? 1 : 0);
}
