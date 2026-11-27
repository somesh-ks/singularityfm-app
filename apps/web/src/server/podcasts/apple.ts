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

/**
 * Apple's top-podcasts chart (itunes.apple.com, no key): the shows people actually listen to, in
 * order, for the whole store or one genre. Category shelves are drawn from it because the Index's
 * "trending" list favours recent activity, not famous shows (measured 27 Nov: 0 or 1 of Apple's top
 * 25 appeared in the Index's list for 12 of 12 topics). A shelf is edge-cached for hours, so the
 * chart costs a few calls a day, outside the search cap.
 */
export const APPLE_CHART = "https://itunes.apple.com/us/rss/toppodcasts";

/** Apple's genre id for each topic name the shelves ask for (lower case, as the route keys it). */
export const APPLE_GENRES: Readonly<Record<string, number>> = {
  technology: 1318,
  business: 1321,
  science: 1533,
  design: 1402,
  news: 1489,
  society: 1324,
};

export type AppleChart = (genre: number | null, limit: number) => Promise<number[]>;

export function createAppleChart(fetch: FetchImpl, timeoutMs = APPLE_TIMEOUT_MS): AppleChart {
  return async (genre, limit) => {
    const path = `${APPLE_CHART}/limit=${limit}${genre === null ? "" : `/genre=${genre}`}/json`;
    const response = await fetch(path, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Apple answered ${response.status}.`);
    }
    const body = (await response.json()) as { feed?: { entry?: unknown } };
    const entries = Array.isArray(body.feed?.entry) ? (body.feed.entry as unknown[]) : [];
    return entries.flatMap((entry) => {
      const id = Number(
        (entry as { id?: { attributes?: Record<string, string> } }).id?.attributes?.["im:id"],
      );
      return Number.isInteger(id) && id > 0 ? [id] : [];
    });
  };
}
