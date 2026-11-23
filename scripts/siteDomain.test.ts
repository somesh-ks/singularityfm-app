import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter((path) => path && path !== "site.json" && !RECORDS.test(path));
    const offenders = tracked.flatMap((path) => {
      let text: string;
      try {
        text = readFileSync(resolve(ROOT, path), "utf8");
      } catch {
        return [];
      }
      return site.retired.filter((host) => text.includes(host)).map((host) => `${path}: ${host}`);
    });
    expect(offenders).toEqual([]);
    expect(site.retired).not.toContain(new URL(site.url).hostname);
  });
});
