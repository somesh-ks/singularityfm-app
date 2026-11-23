import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import site from "../site.json" with { type: "json" };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Records stay as written: a move adds a decision, it does not rewrite the old ones.
const RECORDS = /^docs\/(history|decisions)\//;

describe("the site's address", () => {
  // 2026-11-22: the site moved to .com, every repo still named .work, and smoke and health probed
  // the old host's 308 for two days (#824, #825). site.json is the one home of the address.
  it("leaves no old domain behind after a move", () => {
    // git grep reads tracked files only and skips binaries; it exits 1 when nothing matches.
    const offenders = site.retired.flatMap((host) => {
      let found = "";
      try {
        found = execFileSync("git", ["grep", "-l", "-I", "-F", host], {
          cwd: ROOT,
          encoding: "utf8",
        });
      } catch (error) {
        // Exit 1 is "no match"; anything else is a scan that did not run, never a pass.
        if ((error as { status?: number }).status === 1) return [];
        throw error;
      }
      return found
        .split("\n")
        .filter((path) => path && path !== "site.json" && !RECORDS.test(path))
        .map((path) => `${path}: ${host}`);
    });
    expect(offenders).toEqual([]);
    expect(site.retired).not.toContain(new URL(site.url).hostname);
  });
});
