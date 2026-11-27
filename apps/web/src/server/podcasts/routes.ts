import type { ApiResult } from "../http";
import { APPLE_PER_MINUTE, type AppleSearch } from "./apple";
import { IndexError, type IndexGet } from "./podcastIndex";
import {
  DESCRIPTION_MAX,
  type EpisodeRow,
  episodeFromIndex,
  NOTES_MAX,
  type ShowDetail,
  type ShowRow,
  showDetailFromIndex,
  showFromApple,
  showFromIndex,
  uniqueShows,
} from "./shapes";
import type { Signer } from "./signing";

/**
 * The four list routes under /api/podcasts/: search, trending, show and new episodes. Each answer is
 * the same for everyone who asks the same address, so Vercel's edge keeps it (EDGE_SECONDS) and
 * serves a stale copy for a day while refreshing and for a week when we fail (stale-if-error), so an
 * index outage costs freshness, not the app. A failure is never kept.
 *
 * Every route first rewrites its query to one canonical form (search text lowercased and its spaces
 * collapsed, show ids sorted, times rounded) and answers a 308 to it, so the edge holds one copy per
 * question, whoever asked and however they typed it.
 */

export const EDGE_SECONDS = {
  search: 3600,
  search_apple: 86_400,
  trending: 6 * 3600,
  show: 900,
  new: 900,
} as const;

/** The browser keeps an answer at most this long; the edge holds the rest. */
const BROWSER_SECONDS = 300;
const STALE_WHILE_REVALIDATE = 86_400;
const STALE_IF_ERROR = 7 * 86_400;

export function edgeHeaders(seconds: number): Record<string, string> {
  return {
    "Cache-Control": `public, max-age=${Math.min(seconds, BROWSER_SECONDS)}`,
    "Vercel-CDN-Cache-Control": `max-age=${seconds}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}, stale-if-error=${STALE_IF_ERROR}`,
  };
}

/** A failure is never kept, by the browser or the edge. */
export const NEVER_KEPT = {
  "Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
} as const;

export type ErrorCode = "invalid" | "not_found" | "rate_limited" | "upstream" | "not_configured";

export interface ErrorBody {
  error: ErrorCode;
  message: string;
}

export function failure(status: number, error: ErrorCode, message: string): ApiResult<ErrorBody> {
  return { status, body: { error, message }, headers: { ...NEVER_KEPT } };
}

/** The answer when an index call threw: not found stays a 404, anything else is the index's failure. */
function indexFailure(error: unknown): ApiResult<ErrorBody> {
  if (error instanceof IndexError && error.code === "not_found") {
    return failure(404, "not_found", "No such show.");
  }
  return failure(502, "upstream", "The podcast index did not answer.");
}

export interface PodcastDeps {
  index: IndexGet;
  apple: AppleSearch;
  sign: Signer;
  /** One slot of a shared per-minute cap; false when it is full. */
  limit: (bucket: string, perMinute: number) => Promise<boolean>;
  now?: () => number;
}

// ------------------------------------------------------------------------------- canonical queries

/** Either the canonical query string, or why the request cannot be answered. */
export type Canonical = { query: string } | { error: ApiResult<ErrorBody> };

const invalid = (message: string): Canonical => ({ error: failure(400, "invalid", message) });

/** Search text as the edge keys it: one form for every way of typing the same words. */
export function normalizeTerm(raw: string): string {
  return raw.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export const TERM_MIN = 2;
export const TERM_MAX = 100;

export function canonicalSearch(params: URLSearchParams): Canonical {
  const term = normalizeTerm(params.get("q") ?? "");
  if (term.length < TERM_MIN || term.length > TERM_MAX) {
    return invalid(`Search for ${TERM_MIN} to ${TERM_MAX} characters.`);
  }
  return { query: new URLSearchParams({ q: term }).toString() };
}

export function canonicalTrending(params: URLSearchParams): Canonical {
  const topic = normalizeTerm(params.get("topic") ?? "");
  const lang = normalizeTerm(params.get("lang") ?? "en");
  if (topic.length > 40 || !/^[\p{L}\p{N} &-]*$/u.test(topic)) return invalid("Unknown topic.");
  if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(lang)) return invalid("Unknown language.");
  const query = new URLSearchParams({ lang });
  if (topic) query.set("topic", topic);
  query.sort();
  return { query: query.toString() };
}

export const SHOW_PAGE_SIZES = [50, 1000] as const;

export function canonicalShow(params: URLSearchParams): Canonical {
  const max = Number(params.get("max") ?? SHOW_PAGE_SIZES[0]);
  if (!SHOW_PAGE_SIZES.includes(max as 50)) return invalid("Ask for 50 or 1000 episodes.");
  const query = new URLSearchParams();
  const id = params.get("id");
  const apple = params.get("apple");
  const url = params.get("url");
  if (id !== null) {
    if (!/^[1-9]\d{0,11}$/.test(id)) return invalid("Unknown show.");
    query.set("id", id);
  } else if (apple !== null) {
    if (!/^[1-9]\d{0,11}$/.test(apple)) return invalid("Unknown show.");
    query.set("apple", apple);
  } else if (url !== null) {
    let feed: URL;
    try {
      feed = new URL(url.trim());
    } catch {
      return invalid("That is not a feed address.");
    }
    if (!/^https?:$/.test(feed.protocol) || url.length > 2048) {
      return invalid("That is not a feed address.");
    }
    feed.hash = "";
    query.set("url", feed.toString());
  } else {
    return invalid("Name a show by id, apple or url.");
  }
  if (max !== SHOW_PAGE_SIZES[0]) query.set("max", String(max));
  return { query: query.toString() };
}

export const NEW_MAX_SHOWS = 200;
/** `since` is rounded down to this, so a phone opening the app twice in a quarter hour asks the same question. */
export const NEW_SINCE_STEP_S = 900;
/** The furthest back the new-episodes route looks. */
export const NEW_LOOKBACK_S = 30 * 86_400;

export function canonicalNew(params: URLSearchParams, nowMs: number): Canonical {
  const raw = (params.get("ids") ?? "").split(",").filter((part) => part !== "");
  if (raw.length === 0 || raw.some((part) => !/^[1-9]\d{0,11}$/.test(part))) {
    return invalid("Give show ids, separated by commas.");
  }
  const ids = [...new Set(raw.map(Number))].sort((a, b) => a - b);
  if (ids.length > NEW_MAX_SHOWS) return invalid(`At most ${NEW_MAX_SHOWS} shows.`);
  const now = Math.floor(nowMs / 1000);
  const asked = Number(params.get("since") ?? 0);
  const since = Math.max(Number.isFinite(asked) ? asked : 0, now - NEW_LOOKBACK_S);
  const rounded = Math.floor(Math.min(since, now) / NEW_SINCE_STEP_S) * NEW_SINCE_STEP_S;
  return {
    query: new URLSearchParams({ ids: ids.join(","), since: String(rounded) }).toString(),
  };
}

// ------------------------------------------------------------------------------------- handlers

type Raw = Record<string, unknown>;
const listOf = (body: unknown, key: string): Raw[] => {
  const value = (body as Raw | null)?.[key];
  return Array.isArray(value) ? (value as Raw[]) : [];
};

export const SEARCH_MAX = 20;

export interface SearchBody {
  shows: ShowRow[];
  source: "index" | "apple" | "none";
}

/** Podcast Index first; Apple when the index fails or finds nothing, within Apple's shared cap. */
export async function searchShows(
  term: string,
  deps: PodcastDeps,
  /** Off where an Apple row is no use: a resolve keeps only shows the index knows. */
  appleFallback = true,
): Promise<ApiResult<SearchBody | ErrorBody>> {
  try {
    const body = await deps.index("/search/byterm", { q: term, max: String(SEARCH_MAX) });
    const shows = uniqueShows(
      listOf(body, "feeds")
        .filter((feed) => feed.dead !== 1 && feed.dead !== true)
        .map((feed) => showFromIndex(feed, deps.sign))
        .filter((row): row is ShowRow => row !== null),
    );
    if (shows.length > 0) {
      return {
        status: 200,
        body: { shows, source: "index" },
        headers: edgeHeaders(EDGE_SECONDS.search),
      };
    }
  } catch {
    // A failing index falls through to Apple, as an empty one does.
  }
  if (!appleFallback) {
    return {
      status: 200,
      body: { shows: [], source: "none" },
      headers: edgeHeaders(EDGE_SECONDS.search),
    };
  }
  // Apple not asked or not answering is an unfinished search, never a kept "no results".
  if (!(await deps.limit("podcasts:apple", APPLE_PER_MINUTE))) {
    return failure(503, "rate_limited", "Search is busy. Try again in a minute.");
  }
  try {
    const results = await deps.apple(term, SEARCH_MAX);
    const shows = uniqueShows(
      results
        .map((result) => showFromApple(result, deps.sign))
        .filter((row): row is ShowRow => row !== null),
    );
    return {
      status: 200,
      body: { shows, source: shows.length > 0 ? "apple" : "none" },
      headers: edgeHeaders(EDGE_SECONDS.search_apple),
    };
  } catch {
    return failure(502, "upstream", "Search did not answer.");
  }
}

export const TRENDING_MAX = 30;

export async function trendingShows(
  params: URLSearchParams,
  deps: PodcastDeps,
): Promise<ApiResult<{ shows: ShowRow[] } | ErrorBody>> {
  const query: Record<string, string> = {
    max: String(TRENDING_MAX),
    lang: params.get("lang") ?? "en",
  };
  const topic = params.get("topic");
  if (topic) query.cat = topic;
  try {
    const body = await deps.index("/podcasts/trending", query);
    const shows = uniqueShows(
      listOf(body, "feeds")
        .map((feed) => showFromIndex(feed, deps.sign))
        .filter((row): row is ShowRow => row !== null),
    );
    return { status: 200, body: { shows }, headers: edgeHeaders(EDGE_SECONDS.trending) };
  } catch (error) {
    return indexFailure(error);
  }
}

export interface ShowBody {
  show: ShowDetail;
  episodes: EpisodeRow[];
}

const episodesOf = (body: unknown, sign: Signer, notesMax?: number): EpisodeRow[] =>
  listOf(body, "items")
    .map((item) => episodeFromIndex(item, sign, notesMax))
    .filter((row): row is EpisodeRow => row !== null)
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));

export async function showWithEpisodes(
  params: URLSearchParams,
  deps: PodcastDeps,
): Promise<ApiResult<ShowBody | ErrorBody>> {
  try {
    const id = params.get("id");
    const apple = params.get("apple");
    const lookup = id
      ? deps.index("/podcasts/byfeedid", { id })
      : apple
        ? deps.index("/podcasts/byitunesid", { id: apple })
        : deps.index("/podcasts/byfeedurl", { url: params.get("url") ?? "" });
    const feed = ((await lookup) as Raw | null)?.feed;
    // The index answers an unknown show with an empty list in place of the feed.
    const show =
      feed && typeof feed === "object" && !Array.isArray(feed)
        ? showDetailFromIndex(feed as Raw, deps.sign)
        : null;
    if (!show || show.id === null) return failure(404, "not_found", "No such show.");
    const max = params.get("max") ?? String(SHOW_PAGE_SIZES[0]);
    const episodes = await deps.index("/episodes/byfeedid", {
      id: String(show.id),
      max,
      fulltext: "",
    });
    // The newest page is what an episode's page reads, so its notes come whole; the long page is a list.
    const notesMax = max === String(SHOW_PAGE_SIZES[0]) ? NOTES_MAX : DESCRIPTION_MAX;
    return {
      status: 200,
      body: { show, episodes: episodesOf(episodes, deps.sign, notesMax) },
      // Tagged by show, so a later refresher can drop one show's copies at once.
      headers: { ...edgeHeaders(EDGE_SECONDS.show), "Vercel-Cache-Tag": `podcast-show-${show.id}` },
    };
  } catch (error) {
    return indexFailure(error);
  }
}

/** The most episodes one new-episodes answer carries, newest first. */
export const NEW_MAX_EPISODES = 300;

/** Everything new across up to 200 shows since a time, in one index call. */
export async function newEpisodes(
  params: URLSearchParams,
  deps: PodcastDeps,
): Promise<ApiResult<{ episodes: EpisodeRow[] } | ErrorBody>> {
  try {
    const body = await deps.index("/episodes/byfeedid", {
      id: params.get("ids") ?? "",
      since: params.get("since") ?? "0",
      max: String(NEW_MAX_EPISODES),
      fulltext: "",
    });
    return {
      status: 200,
      body: { episodes: episodesOf(body, deps.sign) },
      headers: edgeHeaders(EDGE_SECONDS.new),
    };
  } catch (error) {
    return indexFailure(error);
  }
}
