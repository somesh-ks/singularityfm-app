// An existing test changes only with the owner's OK (code.md, Tests). The rule lived in prose alone,
// and #791 edited engine tests, asked "say if you object" afterwards and merged with no answer. This
// gate fails a pull request that removes lines from an existing *.test.ts or *.spec.ts file, deletes
// or renames one, or changes or deletes a screenshot (*-snapshots/*), unless it carries the
// `tests-ok` label. Lines added to an existing test file and new test files pass, so extending a
// test stays cheap. After his OK in chat, add the label, link his message in the pull request body,
// then re-run the check: ci.yml does not run on `labeled`, so the label is read live with `gh`.
// shortcut: shared helpers, fixtures and the Playwright configs are not gated, though a change there
// can weaken many tests; add their paths if a PR loosens one without his OK.
// Usage in CI: PR=<number> BASE=<sha> GH_TOKEN=<token> node scripts/testEditGate.mjs
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LABEL = "tests-ok";

const TEST = /\.(?:test|spec)\.ts$/;
const SNAPSHOT = /-snapshots\//;

/**
 * The existing tests a change edits, given each changed file's status (A, M or D, renames split into
 * D and A) and how many lines it deletes. Empty means it may go on without the label.
 */
export function editedTests(files) {
  return files
    .filter(
      ({ path, status, deleted }) =>
        (SNAPSHOT.test(path) && status !== "A") ||
        (TEST.test(path) && (status === "D" || deleted > 0)),
    )
    .map(({ path }) => path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { BASE: base, PR: pr } = process.env;
  if (!pr || !base || /^0+$/.test(base)) {
    console.log("test-edit gate: not a pull request, nothing to check");
    process.exit(0);
  }
  // As in designSystemGate.mjs: CI checks out the pull request merged into the base as it is now, so
  // the merge's first parent is that base; a local run compares against BASE.
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
  const merged =
    process.env.GITHUB_ACTIONS === "true" &&
    git("rev-list", "--parents", "-n", "1", "HEAD").trim().split(" ").length === 3;
  const range = merged ? ["HEAD^1", "HEAD"] : [`${base}...HEAD`];
  const lines = (...args) =>
    git("diff", "--no-renames", ...args, ...range)
      .split("\n")
      .filter(Boolean);
  const deleted = new Map(
    lines("--numstat").map((line) => {
      const [, removed, path] = line.split("\t");
      return [path, removed === "-" ? 0 : Number(removed)];
    }),
  );
  const files = lines("--name-status").map((line) => {
    const [status, path] = line.split("\t");
    return { path, status, deleted: deleted.get(path) ?? 0 };
  });
  const edited = editedTests(files);
  if (edited.length === 0) {
    console.log(`test-edit gate passed (${files.length} files, no existing test edited)`);
    process.exit(0);
  }
  let labels;
  try {
    labels = JSON.parse(
      execFileSync("gh", ["pr", "view", pr, "--json", "labels", "--jq", "[.labels[].name]"], {
        encoding: "utf8",
      }),
    );
  } catch (error) {
    console.log(
      `::error::test-edit gate: could not read the pull request's labels (${error.message.split("\n")[0]}); re-run this job`,
    );
    process.exit(1);
  }
  if (labels.includes(LABEL)) {
    console.log(`test-edit gate passed: "${LABEL}" covers ${edited.length} edited test file(s)`);
    process.exit(0);
  }
  console.log(
    `::error::This pull request edits existing tests (${edited.join(", ")}). Ask the owner once with ` +
      `the list; after his OK, add the "${LABEL}" label, link his message in the pull request body ` +
      "and re-run this check.",
  );
  process.exit(1);
}
