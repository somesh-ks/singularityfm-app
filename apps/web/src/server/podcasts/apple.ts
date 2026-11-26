import type { FetchImpl } from "../sourcePreview";
import { USER_AGENT } from "./podcastIndex";

/**
 * Apple's podcast search (itunes.apple.com), the fallback when Podcast Index fails or finds nothing.
 * No key. Apple allows about 20 calls a minute in all, so the route asks the shared limiter for
 * one of APPLE_PER_MINUTE slots first, and the edge keeps an Apple answer a day.
 */

export const APPLE_SEARCH = "https://itunes.apple.com/search";
export const APPLE_PER_MINUTE = 15;
export const APPLE_TIMEOUT_MS = 2500;

export type AppleSearch = (term: string, limit: number) => Promise<Record<string, unknown>[]>;

export function createAppleSearch(fetch: FetchImpl, timeoutMs = APPLE_TIMEOUT_MS): AppleSearch {
  return async (term, limit) => {
    const query = new URLSearchParams({
      media: "podcast",
      entity: "podcast",
      term,
      limit: String(limit),
    });
    const response = await fetch(`${APPLE_SEARCH}?${query}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Apple answered ${response.status}.`);
    }
    const body = (await response.json()) as { results?: unknown };
    return Array.isArray(body.results) ? (body.results as Record<string, unknown>[]) : [];
  };
}
