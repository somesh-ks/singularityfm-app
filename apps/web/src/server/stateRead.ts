import { stateStoreUrl } from "@singularityfm/engine/config-paths";
import { type DatabaseCall, deploymentDatabaseUrl, guardedDatabase } from "./database";
import type { createGitHubClient } from "./github";

/** What the read looks at in the site's environment. */
export interface StateReadEnv {
  DATABASE_URL?: string | undefined;
  SINGULARITY_STATE_STORE?: string | undefined;
  VERCEL?: string | undefined;
  VERCEL_ENV?: string | undefined;
}

/** The run state is on and did not answer; main no longer holds it (D300 step 3, PR 5). */
export class StateUnreadable extends Error {}

/** Longer than the site's usual second: a caller that gets nothing here stops or shows no estimate. */
const STATE_READ_TIMEOUT_MS = 5000;

const unreadable = Symbol("unreadable");
const calls = new Map<string, DatabaseCall>();

/** One guarded call per URL, so a sleeping or broken database costs one wait and then backs off. */
function sharedCall(url: string): DatabaseCall {
  let call = calls.get(url);
  if (call === undefined) {
    call = guardedDatabase({ databaseUrl: url, timeoutMs: STATE_READ_TIMEOUT_MS });
    calls.set(url, call);
  }
  return call;
}

export interface StateReadDeps {
  /** Tests pass a fake; left out, the shared guarded call is used. */
  database?: DatabaseCall;
}

/**
 * A run-state file (state/last-run.json and its kin) as text, or null when there is none. With the
 * state store on (SINGULARITY_STATE_STORE=postgres, as for the engine, D381) the store is the only
 * copy: main's stops moving once the engine stops committing state, so a store that does not answer
 * throws StateUnreadable instead of handing back a frozen file. With it off, main answers as before.
 */
export async function readStateFile(
  path: string,
  github: Pick<ReturnType<typeof createGitHubClient>, "readFile">,
  env: StateReadEnv,
  deps: StateReadDeps = {},
): Promise<string | null> {
  const url = stateStoreUrl({
    DATABASE_URL: deploymentDatabaseUrl(env),
    SINGULARITY_STATE_STORE: env.SINGULARITY_STATE_STORE,
  });
  if (url === null) return github.readFile(path, "main");
  const call = deps.database ?? sharedCall(url);
  const rows = await call<Record<string, unknown>[] | typeof unreadable>(
    (sql) => sql.query("select content from state_documents where path = $1", [path]),
    unreadable,
  );
  if (rows === unreadable) throw new StateUnreadable();
  const content = rows[0]?.content;
  return typeof content === "string" ? content : null;
}
