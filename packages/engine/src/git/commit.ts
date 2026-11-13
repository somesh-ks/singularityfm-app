import { STATE_SAVING_COMMANDS, saveStateIfOn } from "../store/stateSave.js";
import type { GitCommand } from "./guard.js";

export interface SaveRunStateInput {
  root: string;
  /** Selects the write allowlist the state save keeps to. */
  command: GitCommand;
  push: boolean;
  /** Injected for tests; defaults to saving the run state to Postgres when that store is on (D381). */
  saveState?: (root: string, command: GitCommand) => Promise<string[]>;
}

export type CommitOutcome =
  | { status: "nothing_to_commit" }
  /** Nothing for git (the run state is not in it, D300): the run state went to Postgres alone. */
  | { status: "saved"; paths: string[] }
  /** The run state did not reach Postgres. */
  | { status: "save_failed"; detail: string };

/**
 * Save the run state to Postgres, for the commands that write it (D381). Git carries neither the
 * run state nor the content (D300), so there is no commit and no push: a local `--no-push` run
 * saves nothing. A failed save is a failed commit, so the run ends red and the caller marks it done
 * as it does for any other failure.
 */
export async function saveRunState(input: SaveRunStateInput): Promise<CommitOutcome> {
  if (!input.push || !STATE_SAVING_COMMANDS.has(input.command)) {
    return { status: "nothing_to_commit" };
  }
  try {
    const saved = await (input.saveState ?? saveStateIfOn)(input.root, input.command);
    return saved.length === 0 ? { status: "nothing_to_commit" } : { status: "saved", paths: saved };
  } catch (error) {
    return {
      status: "save_failed",
      detail: `the run state was not saved to Postgres: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
