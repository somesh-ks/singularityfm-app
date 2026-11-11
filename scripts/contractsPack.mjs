// The contracts package as the admin repository gets it (D382 step 3): `pnpm pack` it, install the
// tarball outside the workspace, and import every subpath with plain Node. A Vercel function cannot load
// a package that ships TypeScript source (#485), and the workspace link serves the .ts files, so a
// broken `publishConfig.exports`, a file missing from `files` or an import the build did not emit
// passes every other check and fails only here.
//
// Usage: node scripts/contractsPack.mjs  (installs offline from the pnpm store when it can)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const packageDir = join(root, "packages/contracts");
const { dependencies } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const work = mkdtempSync(join(tmpdir(), "contracts-pack-"));
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  run("pnpm", ["pack", "--pack-destination", work], packageDir);
  const tarball = readdirSync(work).find((file) => file.endsWith(".tgz"));
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({
      name: "contracts-pack-check",
      private: true,
      type: "module",
      dependencies: { ...dependencies, "@singularityfm/contracts": `file:./${tarball}` },
    }),
  );
  run("pnpm", ["install", "--prefer-offline", "--ignore-workspace"], work);
  // Every value the admin repository imports, and every health table, by name, so a dropped
  // re-export fails too.
  writeFileSync(
    join(work, "check.mjs"),
    `import * as health from "@singularityfm/contracts/health";
import * as session from "@singularityfm/contracts/session";
import * as store from "@singularityfm/contracts/store";
const want = {
  health: ["HEALTH_DEVICES", "HEALTH_GROUPS", "HEALTH_JOBS", "HEALTH_SPEED", "HEALTH_TILES"],
  session: ["COOKIE", "cookieOf", "createSession", "hmac", "same", "SESSION_SECONDS", "sessionValid"],
  store: [
    "configStoreUrl",
    "connectNeon",
    "readExperimentFlags",
    "readExperimentHits",
    "readStageTimings",
    "setExperimentEnabled",
    "setExperimentPromoted",
  ],
};
const missing = [
  ...want.health.filter((name) => !(name in health)),
  ...want.session.filter((name) => !(name in session)),
  ...want.store.filter((name) => !(name in store)),
];
if (missing.length) throw new Error("missing exports: " + missing.join(", "));
const value = await session.createSession("s".repeat(32), Date.now());
if (!(await session.sessionValid(value, "s".repeat(32), Date.now()))) throw new Error("session round trip failed");
`,
  );
  run(process.execPath, ["check.mjs"], work);
  console.log(`${tarball}: packs, installs and imports as plain JavaScript`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
