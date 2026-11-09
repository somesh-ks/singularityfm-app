// The next free decision number across main and every pushed branch. Two threads that start apart
// otherwise take the same number (D157, D159, D176, D297); the coordinator that used to hand them
// out is not there for every tool. Usage: pnpm run decision:next, then push the entry file at once:
// a pushed branch is the claim the next run sees.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENTRIES = "docs/decisions/entries/";

// Entry paths from any number of refs; the highest D-number plus one.
export function nextDecision(paths) {
  const ids = paths.flatMap((path) =>
    [...path.matchAll(/\bD(\d+)\.md$/g)].map((m) => Number(m[1])),
  );
  return `D${Math.max(0, ...ids) + 1}`;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  git("fetch", "--prune", "-q", "origin");
  const refs = git("for-each-ref", "--format=%(refname)", "refs/remotes/origin").split("\n");
  const paths = refs.flatMap((ref) =>
    git("ls-tree", "--name-only", ref, ENTRIES).split("\n").filter(Boolean),
  );
  console.log(
    `${nextDecision(paths)}: free on main and ${refs.length - 1} pushed branches. Write ${ENTRIES}<it>.md and push it now.`,
  );
}
