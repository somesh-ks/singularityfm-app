import type { CommitOutcome } from "../git/commit.js";
import { PodcastError } from "./types.js";

/**
 * A failed run in one plain sentence for the run indicator (failure.json in Blob carries it to the
 * status route). The listener never sees a git word or a link into the repository.
 */
export function commitFailureReason(outcome: CommitOutcome): string | null {
  switch (outcome.status) {
    case "nothing_to_commit":
      return "The episode was made but nothing was saved. Try again.";
    default:
      return null;
  }
}

/** A thrown error as a sentence: a request or story problem says its own words; the rest is generic. */
export function errorFailureReason(error: unknown): string {
  return error instanceof PodcastError
    ? error.message.slice(0, 280)
    : "Something unexpected stopped the run. Try again; Details in the queue has the run to report.";
}
