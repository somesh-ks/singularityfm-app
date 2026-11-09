import type { SqlClient } from "@singularityfm/engine/config-paths";
import { connectNeon } from "@singularityfm/engine/neon";
import type { createGitHubClient } from "./github";

/** A database that hangs must not spend a poll or the cron's one call an hour: main answers instead. */
export const STATE_READ_TIMEOUT_MS = 5000;

export interface StateReadDeps {
  /** The site's environment, passed in so a test never reaches a database it did not set up. */
  env?: { DATABASE_URL?: string };
  /** Tests pass a fake; left out, the Neon driver is used. */
  connect?: (databaseUrl: string) => SqlClient;
}

/**
 * A run-state file (state/last-run.json and its kin) as text. The state store holds the current
 * copy (D381); main holds the copy as of the last commit that carried state, which stops moving when
 * the engine stops committing state (D300 step 3, PR 5). So the store answers first, and main only
 * when the site has no database, the store has no row for the path or it did not answer in time.
 */
export async function readStateFile(
  path: string,
  github: Pick<ReturnType<typeof createGitHubClient>, "readFile">,
  deps: StateReadDeps = {},
): Promise<string | null> {
  const url = deps.env?.DATABASE_URL;
  if (url) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const sql = (deps.connect ?? connectNeon)(url);
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("no answer in time")), STATE_READ_TIMEOUT_MS);
      });
      const rows = await Promise.race([
        sql.query("select content from state_documents where path = $1", [path]),
        late,
      ]);
      const content = rows[0]?.content;
      if (typeof content === "string") return content;
    } catch {
      // The table is missing (the store was never turned on) or the database did not answer.
    } finally {
      clearTimeout(timer);
    }
  }
  return github.readFile(path, "main");
}
