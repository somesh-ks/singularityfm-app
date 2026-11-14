import { describe, expect, it } from "vitest";
import { ALLOWLISTS, isPathAllowed } from "../src/git/guard.js";

describe("ALLOWLISTS", () => {
  // The bug it prevents: a dry run's ledger commit also taking a digest or usage change that was in
  // the tree (D228), which `publish` would have allowed.
  it("lets a dry run's ledger commit take the ledger and nothing else", () => {
    expect(isPathAllowed("state/costs-2026-10.json", ALLOWLISTS.costs)).toBe(true);
    // The dry run's fetch fills this cache; without it in the list the costs commit was refused.
    expect(isPathAllowed("state/video-text.json", ALLOWLISTS.costs)).toBe(true);
    expect(isPathAllowed("state/usage.json", ALLOWLISTS.costs)).toBe(false);
    expect(isPathAllowed("Digests/2026/10/2026-10-29.md", ALLOWLISTS.costs)).toBe(false);
  });
});

describe("isPathAllowed", () => {
  it.each([
    ["Digests/2026/10/2026-10-07.md", true],
    ["Digests/2026/10/2026-10-07.audio.json", true],
    ["state/seen.json", true],
    ["state/runs/2026-10-07.json", true],
    ["config/preferences.json", false],
    ["package.json", false],
    ["Digests", false],
    ["DigestsX/a.md", false],
    ["docs/Digests/a.md", false],
    ["statefile.json", false],
  ])("run: %s -> %s", (path, expected) => {
    expect(isPathAllowed(path, ALLOWLISTS.run)).toBe(expected);
  });

  it.each([
    ["Digests/2026/10/2026-10-07.audio.json", true],
    ["Digests/2026/10/2026-10-07.md", true],
    ["Digests/2026/10/2026-10-07-weekly.md", true],
    ["Digests/x.md", true],
    ["state/usage.json", true],
    ["state/seen.json", false],
    ["state/judgments.json", false],
    ["state/last-run.json", false],
    ["state/usage.json.bak", false],
    ["Digests/2026/10/2026-10-07.audio.json.bak", false],
    ["Digests/2026/10/2026-10-07.json", false],
    ["Digests/2026/10/notes.txt", false],
    ["config/preferences.json", false],
    [".github/workflows/run.yml", false],
  ])("publish: %s -> %s", (path, expected) => {
    expect(isPathAllowed(path, ALLOWLISTS.publish)).toBe(expected);
  });

  it("matches ** across directories and * within one segment", () => {
    expect(isPathAllowed("a/b/c/d.txt", ["a/**/d.txt"])).toBe(true);
    expect(isPathAllowed("a/d.txt", ["a/**/d.txt"])).toBe(true);
    expect(isPathAllowed("a/b/c.txt", ["a/*.txt"])).toBe(false);
    expect(isPathAllowed("a/c.txt", ["a/*.txt"])).toBe(true);
    expect(isPathAllowed("a/b?.txt", ["a/b?.txt"])).toBe(true);
  });

  it("treats regular expression characters in a pattern literally", () => {
    expect(isPathAllowed("state/usage.json", ["state/usage.json"])).toBe(true);
    expect(isPathAllowed("state/usageXjson", ["state/usage.json"])).toBe(false);
    expect(isPathAllowed("state/a+b.json", ["state/a+b.json"])).toBe(true);
  });

  it("rejects paths that escape the repository", () => {
    expect(isPathAllowed("Digests/../config/preferences.json", ALLOWLISTS.run)).toBe(false);
    expect(isPathAllowed("../state/seen.json", ALLOWLISTS.run)).toBe(false);
    expect(isPathAllowed("/state/seen.json", ALLOWLISTS.run)).toBe(false);
    expect(isPathAllowed("C:/state/seen.json", ALLOWLISTS.run)).toBe(false);
    expect(isPathAllowed("", ALLOWLISTS.run)).toBe(false);
  });

  it("normalizes a leading ./", () => {
    expect(isPathAllowed("./state/seen.json", ALLOWLISTS.run)).toBe(true);
  });

  it("rejects any path containing a backslash, which is a literal file name character in git", () => {
    expect(isPathAllowed("Digests\\2026\\10\\x.md", ALLOWLISTS.run)).toBe(false);
    expect(isPathAllowed("Digests\\2026\\10\\x.md", ALLOWLISTS.publish)).toBe(false);
    expect(isPathAllowed("state/a\\b.json", ALLOWLISTS.run)).toBe(false);
  });
});
