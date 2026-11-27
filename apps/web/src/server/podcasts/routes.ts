import type { ApiResult } from "../http";
import { APPLE_GENRES, APPLE_PER_MINUTE, type AppleChart, type AppleSearch } from "./apple";
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
  /** Apple was busy or down, so the list is the index's order alone: kept briefly. */
  search_degraded: 300,
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
  /** Apple's top charts; a shelf falls back to the index's trending list without it. */
  chart?: AppleChart;
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
  // A shelf Apple's chart answers (every general topic) ignores the language, so it keeps one edge copy.
  const charted = topic === "" || Object.hasOwn(APPLE_GENRES, topic);
  const query = new URLSearchParams({ lang: charted ? "en" : lang });
  if (topic) query.set("topic", topic);
  query.sort();
  return { query: query.toString() };
}

/**
 * A signed file's address with only the parameters its route reads, in one order. An extra one (a
 * cache-buster) is answered a 308 to the plain address, so it never makes a second fetch and resize.
 */
export const canonicalFile =
  (names: readonly string[]) =>
  (params: URLSearchParams): Canonical => {
    const query = new URLSearchParams();
    for (const name of names) {
      const value = params.get(name);
      if (value !== null) query.set(name, value);
    }
    return { query: query.toString() };
  };

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

const APPLE_LOOKUPS = 8;

/** Shows the index gave for an Apple id, kept in this instance for an hour: a chart's 30 lookups repeat across topics and searches. */
const LOOKUP_KEPT_MS = 3_600_000;
const LOOKUP_MAX = 2000;
const lookups = new Map<number, { row: ShowRow; at: number }>();

/** A show of the index by its Apple id, or null when the index does not have it (or did not answer). */
async function indexShowByApple(appleId: number, deps: PodcastDeps): Promise<ShowRow | null> {
  const now = (deps.now ?? Date.now)();
  const kept = lookups.get(appleId);
  if (kept && now - kept.at < LOOKUP_KEPT_MS) return kept.row;
  try {
    const feed = ((await deps.index("/podcasts/byitunesid", { id: String(appleId) })) as Raw | null)
      ?.feed;
    const row =
      feed && typeof feed === "object" && !Array.isArray(feed)
        ? showFromIndex(feed as Raw, deps.sign)
        : null;
    if (row) {
      if (lookups.size >= LOOKUP_MAX) lookups.clear();
      lookups.set(appleId, { row, at: now });
    }
    return row;
  } catch {
    return null;
  }
}

/**
 * Apple's order first, the index's pages second. Apple ranks by what people play, so a famous show
 * leads (measured 27 Nov: The Daily was 7th and Serial 12th by the index alone). A show Apple lists
 * stands as the index's own row, so it opens a page; an Apple-only show stays as Apple's.
 */
async function blend(
  indexRows: ShowRow[],
  appleResults: Raw[],
  deps: PodcastDeps,
): Promise<ShowRow[]> {
  const byApple = new Map(indexRows.flatMap((row) => (row.apple_id ? [[row.apple_id, row]] : [])));
  const apple = appleResults
    .map((result) => showFromApple(result, deps.sign))
    .filter((row): row is ShowRow => row !== null);
  const missing = apple.filter((row) => row.apple_id && !byApple.has(row.apple_id));
  const found = await Promise.all(
    missing.slice(0, APPLE_LOOKUPS).map((row) => indexShowByApple(row.apple_id as number, deps)),
  );
  missing.slice(0, APPLE_LOOKUPS).forEach((row, i) => {
    const hit = found[i];
    if (hit) byApple.set(row.apple_id as number, hit);
  });
  const led = apple.map((row) => (row.apple_id ? (byApple.get(row.apple_id) ?? row) : row));
  return uniqueShows([...led, ...indexRows]).slice(0, SEARCH_MAX);
}

/**
 * Podcast Index and Apple together, within Apple's shared cap. Apple busy or down while the index
 * answered gives the index's list for a short time; both empty is an unfinished search, never a
 * kept "no results".
 */
export async function searchShows(
  term: string,
  deps: PodcastDeps,
): Promise<ApiResult<SearchBody | ErrorBody>> {
  let indexFailed = false;
  const fromIndex = async (): Promise<ShowRow[]> => {
    try {
      const body = await deps.index("/search/byterm", { q: term, max: String(SEARCH_MAX) });
      return uniqueShows(
        listOf(body, "feeds")
          .filter((feed) => feed.dead !== 1 && feed.dead !== true)
          .map((feed) => showFromIndex(feed, deps.sign))
          .filter((row): row is ShowRow => row !== null),
      );
    } catch {
      // A failing index is an empty one: Apple answers alone, and an empty Apple answer is not kept.
      indexFailed = true;
      return [];
    }
  };
  const fromApple = async (): Promise<Raw[] | "busy" | "down"> => {
    if (!(await deps.limit("podcasts:apple", APPLE_PER_MINUTE))) return "busy";
    try {
      return await deps.apple(term, SEARCH_MAX);
    } catch {
      return "down";
    }
  };
  const [indexRows, apple] = await Promise.all([fromIndex(), fromApple()]);
  if (apple === "busy" || apple === "down") {
    if (indexRows.length > 0) {
      return {
        status: 200,
        body: { shows: indexRows, source: "index" },
        headers: edgeHeaders(EDGE_SECONDS.search_degraded),
      };
    }
    return apple === "busy"
      ? failure(503, "rate_limited", "Search is busy. Try again in a minute.")
      : failure(502, "upstream", "Search did not answer.");
  }
  if (indexFailed && apple.length === 0) return failure(502, "upstream", "Search did not answer.");
  const shows = await blend(indexRows, apple, deps);
  return {
    status: 200,
    body: { shows, source: indexRows.length > 0 ? "index" : shows.length > 0 ? "apple" : "none" },
    headers: edgeHeaders(indexRows.length > 0 ? EDGE_SECONDS.search : EDGE_SECONDS.search_apple),
  };
}

export const TRENDING_MAX = 30;

/** Apple's chart for a topic, each show opened as the index's own row; null when the chart is short or fails. */
async function chartShows(
  topic: string | null,
  deps: PodcastDeps,
): Promise<{ shows: ShowRow[]; complete: boolean } | null> {
  if (!deps.chart) return null;
  const key = topic?.toLowerCase() ?? "";
  if (key !== "" && !Object.hasOwn(APPLE_GENRES, key)) return null;
  try {
    const ids = await deps.chart(key === "" ? null : (APPLE_GENRES[key] ?? null), TRENDING_MAX);
    const rows = await Promise.all(ids.map((id) => indexShowByApple(id, deps)));
    const shows = uniqueShows(rows.filter((row): row is ShowRow => row !== null));
    if (shows.length < CHART_MIN) return null;
    // A chart the index answered for most of its shows is kept for hours; a thin one only briefly.
    return { shows, complete: shows.length >= ids.length * CHART_COMPLETE };
  } catch {
    return null;
  }
}

/** The share of a chart the index must answer for before the shelf is kept for the full window. */
const CHART_COMPLETE = 0.8;

/** A chart with fewer shows than this is a broken one: the index's trending list answers instead. */
const CHART_MIN = 5;

/**
 * A topic's shelf: Apple's chart for it (what people listen to), else the index's trending list
 * when Apple fails or the topic has no genre.
 */
export async function trendingShows(
  params: URLSearchParams,
  deps: PodcastDeps,
): Promise<ApiResult<{ shows: ShowRow[] } | ErrorBody>> {
  const topic = params.get("topic");
  const charted = await chartShows(topic, deps);
  if (charted) {
    return {
      status: 200,
      body: { shows: charted.shows },
      headers: edgeHeaders(charted.complete ? EDGE_SECONDS.trending : EDGE_SECONDS.search_degraded),
    };
  }
  const query: Record<string, string> = {
    max: String(TRENDING_MAX),
    lang: params.get("lang") ?? "en",
  };
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
    // The index's episode list leaves the show's name out (no feedTitle), and the player titles a
    // show's episode by it: an empty name drew the episode's id in the bar.
    const rows = episodesOf(episodes, deps.sign, notesMax).map((row) =>
      row.show_title ? row : { ...row, show_title: show.title },
    );
    return {
      status: 200,
      body: { show, episodes: rows },
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
