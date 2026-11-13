export type GitCommand = "run" | "publish" | "learn" | "podcast" | "config" | "costs";

/**
 * Where each command may save run state. An entry ending in "/" allows everything beneath it; "*"
 * matches within one path segment and "**" across segments. The state store's save keeps to this
 * list (store/stateSave.ts).
 */
export const ALLOWLISTS: Record<GitCommand, readonly string[]> = {
  run: ["Digests/", "state/"],
  publish: ["Digests/**/*.audio.json", "Digests/**/*.md", "state/usage.json", "state/costs-*.json"],
  // A dry run's spend: the ledger, and the transcript cache its fetch fills (D228). The cache was
  // left out and every dry run that read a new video had its costs refused (2026-11-02).
  costs: ["state/costs-*.json", "state/video-text.json"],
  learn: ["config/preferences.json"],
  podcast: ["Podcasts/", "state/costs-*.json", "state/podcast-timings.json"],
  // Exactly the files `singularity config apply` and `singularity sources suggest` write, and no others.
  config: [
    "config/topics.json",
    "config/sources.user.json",
    "config/queries.json",
    "config/preferences.json",
    "config/schedule.json",
    "config/structure.json",
    "config/writer.json",
    "config/profiles/*.json",
    "state/source-candidates.json",
  ],
};

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern.charAt(index);
    if (char === "*" && pattern.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && pattern.charAt(index + 1) === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** True when `path` (repo-relative) is covered by the allowlist. Escapes from the repo never are. */
export function isPathAllowed(path: string, allowlist: readonly string[]): boolean {
  // Git always reports "/" separators. A backslash is therefore a literal character in a file name
  // on Linux, and treating it as a separator would let `Digests\x.md` pass as `Digests/x.md`.
  if (path.includes("\\")) return false;
  const normalized = path.replace(/^\.\//, "");
  if (normalized === "" || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized))
    return false;
  if (normalized.split("/").includes("..")) return false;
  return allowlist.some((entry) =>
    entry.endsWith("/") ? normalized.startsWith(entry) : globToRegExp(entry).test(normalized),
  );
}
