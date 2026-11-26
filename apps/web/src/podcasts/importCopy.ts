import type { ImportOutcome } from "./transfer";

/**
 * What an import says when it is done: one plain sentence, counted, with what is left to do. Pure,
 * so the Import and export page and first run's step 3 say the same.
 */

const shows = (n: number): string => `${n} ${n === 1 ? "show" : "shows"}`;

export function importSummary(outcome: ImportOutcome): string {
  if (outcome.kind === "problem") {
    switch (outcome.problem) {
      case "too_large":
        return "That file is too large to be a list of shows.";
      case "empty_opml":
        return "That file lists no shows.";
      case "newer_version":
        return "That backup comes from a newer version of the app. Reload and try again.";
      default:
        return "That file is not an OPML list or a Singularity backup.";
    }
  }
  if (outcome.kind === "backup") {
    return outcome.changed + outcome.positions + outcome.history === 0
      ? "This device already had everything in that backup."
      : "Backup restored. Newer changes on this device were kept.";
  }
  const parts: string[] = [];
  if (outcome.added > 0) parts.push(`Added ${shows(outcome.added)} to your favorites.`);
  if (outcome.already > 0) {
    parts.push(
      `${shows(outcome.already)} ${outcome.already === 1 ? "was" : "were"} already there.`,
    );
  }
  if (outcome.missing.length > 0) {
    parts.push(`${shows(outcome.missing.length)} couldn't be found. Search for them by name.`);
  }
  if (outcome.failed.length > 0) {
    parts.push(`${shows(outcome.failed.length)} didn't load. Import the file again to retry.`);
  }
  return parts.join(" ");
}

export function importProgress(done: number, total: number): string {
  return `Finding shows, ${done} of ${total}`;
}
