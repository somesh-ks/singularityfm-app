import { createHash } from "node:crypto";
import type { FetchImpl } from "../sourcePreview";

/**
 * The Podcast Index client (api.podcastindex.org): signed requests, a short timeout and a circuit
 * breaker. Its host is fixed, so it needs no outbound guard. The key and secret stay on the server.
 *
 * The breaker is per instance: after BREAKER_FAILURES failures within a minute it skips the index
 * for BREAKER_OPEN_MS, so an outage costs a few slow requests, not every one. While it is open,
 * search answers from Apple and the other routes fail fast; the edge then serves its stale copies.
 */

export const INDEX_BASE = "https://api.podcastindex.org/api/1.0";
export const INDEX_TIMEOUT_MS = 2500;
export const BREAKER_FAILURES = 5;
export const BREAKER_WINDOW_MS = 60_000;
export const BREAKER_OPEN_MS = 5 * 60_000;
export const USER_AGENT = "Singularity/1.0 (podcast player)";

export interface IndexKeys {
  key: string;
  secret: string;
}

/** The two settings, or null when either is missing. */
export function indexKeys(env: Record<string, string | undefined>): IndexKeys | null {
  const key = env.PODCAST_INDEX_API_KEY?.trim();
  const secret = env.PODCAST_INDEX_API_SECRET?.trim();
  return key && secret ? { key, secret } : null;
}

export class IndexError extends Error {
  constructor(
    readonly code: "breaker_open" | "timeout" | "upstream" | "not_found",
    message: string,
  ) {
    super(message);
    this.name = "IndexError";
  }
}

export interface Breaker {
  failures: number[];
  openUntil: number;
}

export const newBreaker = (): Breaker => ({ failures: [], openUntil: 0 });

export interface IndexClientDeps {
  keys: IndexKeys;
  fetch: FetchImpl;
  breaker: Breaker;
  now?: () => number;
  timeoutMs?: number;
}

export type IndexGet = (path: string, params: Record<string, string>) => Promise<unknown>;

export function createIndexClient(deps: IndexClientDeps): IndexGet {
  const now = deps.now ?? Date.now;
  const { breaker } = deps;
  const fail = (at: number) => {
    breaker.failures = breaker.failures.filter((time) => at - time < BREAKER_WINDOW_MS);
    breaker.failures.push(at);
    if (breaker.failures.length >= BREAKER_FAILURES) {
      breaker.openUntil = at + BREAKER_OPEN_MS;
      breaker.failures = [];
    }
  };
  return async (path, params) => {
    const at = now();
    if (at < breaker.openUntil) throw new IndexError("breaker_open", "The index is resting.");
    const date = String(Math.floor(at / 1000));
    const authorization = createHash("sha1")
      .update(deps.keys.key + deps.keys.secret + date)
      .digest("hex");
    const query = new URLSearchParams(params).toString();
    let response: Response;
    try {
      response = await deps.fetch(`${INDEX_BASE}${path}${query ? `?${query}` : ""}`, {
        headers: {
          "User-Agent": USER_AGENT,
          "X-Auth-Key": deps.keys.key,
          "X-Auth-Date": date,
          Authorization: authorization,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(deps.timeoutMs ?? INDEX_TIMEOUT_MS),
      });
    } catch (error) {
      fail(at);
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new IndexError(timedOut ? "timeout" : "upstream", "The index did not answer.");
    }
    if (response.status === 404) {
      await response.body?.cancel();
      throw new IndexError("not_found", "The index does not know that.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      // A 400 is our request, not the index failing; only its failures trip the breaker.
      if (response.status >= 500 || response.status === 429 || response.status === 401) fail(at);
      throw new IndexError("upstream", `The index answered ${response.status}.`);
    }
    try {
      return await response.json();
    } catch {
      fail(at);
      throw new IndexError("upstream", "The index answered something that is not JSON.");
    }
  };
}
