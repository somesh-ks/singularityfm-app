import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./staticServer.mjs";

/**
 * Builds the site for tests, then serves it. The build uses the invented fixture digests and skips
 * the Vercel adapter (SINGULARITY_STATIC_ONLY), which bundles functions with symlinks that Windows
 * refuses without Developer Mode. The output is the same static site either way.
 *
 * Usage: node e2e/run.mjs [--build-only] [--serve-only]
 */

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
const port = Number(process.env.PORT ?? 4321);

// One suite at a time: both browser suites start this script, and a build under a running suite
// swaps the dist it serves (docs/learnings.md, 2026-11-10). The lock holds the PID for the life of the
// build and the server. Playwright kills the server outright (no gracefulShutdown in either config,
// and always on Windows), so the exit handler below rarely runs and the lock stays behind; the next
// run replaces it once its PID is gone, and a recycled PID gets the delete hint in the refusal.
// shortcut: `pnpm run build` and `pnpm run gate --build` also write dist without taking the lock, and
// a suite that reuses a running server never reaches this script; move the lock into the build if
// either clobbers a suite again.
const lock = join(appRoot, "dist.lock");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
for (let attempt = 0; ; attempt += 1) {
  try {
    const fd = openSync(lock, "wx");
    writeSync(fd, String(process.pid));
    closeSync(fd);
    break;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let holder = 0;
    try {
      holder = Number(readFileSync(lock, "utf8"));
    } catch {}
    if (attempt > 0 || (holder > 0 && alive(holder))) {
      console.error(
        `another browser suite is building or serving apps/web/dist (pid ${holder || "unknown"}): run one suite at a time; if none is running, delete apps/web/dist.lock`,
      );
      process.exit(1);
    }
    rmSync(lock, { force: true });
  }
}
process.on("exit", () => rmSync(lock, { force: true }));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => process.exit(signal === "SIGINT" ? 130 : 143));

if (!flags.has("--serve-only")) {
  const astroBin = join(
    dirname(createRequire(import.meta.url).resolve("astro/package.json")),
    "bin",
    "astro.mjs",
  );
  // The owner's config is not in git (D296), and the config route bundles those files: fill what a
  // clean checkout lacks from config/examples. The fixture env keeps it off the config store.
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  const pulled = spawnSync(
    process.execPath,
    [tsx, join(appRoot, "..", "..", "scripts", "pullConfig.ts")],
    {
      stdio: "inherit",
      env: { ...process.env, SINGULARITY_FIXTURES: "1" },
    },
  );
  if (pulled.status !== 0) process.exit(pulled.status ?? 1);
  const build = spawnSync(process.execPath, [astroBin, "build"], {
    cwd: appRoot,
    stdio: "inherit",
    env: { ...process.env, SINGULARITY_FIXTURES: "1", SINGULARITY_STATIC_ONLY: "1" },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

if (!flags.has("--build-only")) {
  startServer({ root: join(appRoot, "dist"), port });
}
