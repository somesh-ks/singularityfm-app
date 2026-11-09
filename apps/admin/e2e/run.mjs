import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./staticServer.mjs";

/**
 * Builds the admin for tests, then serves it under /admin. The Experiments page reads the flag files
 * at build time, so a clean checkout first fills config/ from its examples (D296), as the reader's
 * suite does. shortcut: that step runs the app repository's scripts/pullConfig.ts; the admin's own
 * repository needs its own copy of the example flags (D382 step 5).
 *
 * Usage: node e2e/run.mjs [--build-only] [--serve-only]
 */

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const flags = new Set(process.argv.slice(2));
const port = Number(process.env.PORT ?? 4322);
const require = createRequire(import.meta.url);

if (!flags.has("--serve-only")) {
  const env = { ...process.env, SINGULARITY_FIXTURES: "1", SINGULARITY_STATIC_ONLY: "1" };
  const pulled = spawnSync(
    process.execPath,
    [require.resolve("tsx/cli"), join(appRoot, "..", "..", "scripts", "pullConfig.ts")],
    { stdio: "inherit", env },
  );
  if (pulled.status !== 0) process.exit(pulled.status ?? 1);
  const astro = join(dirname(require.resolve("astro/package.json")), "bin", "astro.mjs");
  const build = spawnSync(process.execPath, [astro, "build"], {
    cwd: appRoot,
    stdio: "inherit",
    env,
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

if (!flags.has("--build-only")) startServer({ root: join(appRoot, "dist"), port });
