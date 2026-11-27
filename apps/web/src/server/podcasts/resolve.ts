import type { ApiResult } from "../http";
import { readCapped } from "../siteIcon";
import { type FetchImpl, guardedFetch, type Resolver, resolveAll } from "../sourcePreview";
import { USER_AGENT } from "./podcastIndex";
import {
  type Canonical,
  EDGE_SECONDS,
  type ErrorBody,
  edgeHeaders,
  failure,
  type PodcastDeps,
  searchShows,
} from "./routes";
import { plainText, type ShowRow, showFromIndex } from "./shapes";

/**
 * GET /api/podcasts/resolve?link=: whatever a person pasted into Add a show, turned into a show the
 * index knows, or the closest matches by name. The ways in, cheapest first:
 *
 * 1. The address as a feed the index knows (and its https twin).
 * 2. The page itself, read once through the outbound guard within a size and time cap:
 *    - a feed: its podcast:guid, then the address it says it moved to (itunes:new-feed-url);
 *    - a web page (a show's site, Pocket Casts, Castro): the feeds it links as alternates, and an
 *      Apple Podcasts id it links to.
 * 3. The page's own name (a feed's title, a page's og:title with "| Podcast on Spotify" and the
 *    like taken off), searched in the index: Spotify and YouTube land here, since they keep their
 *    feeds to themselves.
 *
 * The answer is the same for everyone who pastes the same address, so the edge keeps it like a search.
 */

export const PAGE_MAX_BYTES = 1024 * 1024;
export const PAGE_TIMEOUT_MS = 5000;
/** Alternate feeds a page lists that are tried, at most. */
const ALTERNATES_MAX = 3;
export const MATCHES_MAX = 6;
/** Resolves per client a minute, inside the podcast routes' shared cap. */
export const RESOLVE_PER_MINUTE = 30;

export interface ResolveDeps extends PodcastDeps {
  fetch: FetchImpl;
  resolve?: Resolver;
}

export interface ResolveBody {
  /** The show the link names, when one was found for certain. */
  show: ShowRow | null;
  /** Otherwise the closest shows by the page's name, best first; empty when it had none. */
  matches: ShowRow[];
  /** The name the matches were searched by. */
  name: string | null;
}

type Raw = Record<string, unknown>;

export function canonicalResolve(params: URLSearchParams): Canonical {
  const link = params.get("link")?.trim() ?? "";
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { error: failure(400, "invalid", "That is not a link.") };
  }
  if (!/^https?:$/.test(url.protocol) || link.length > 2048) {
    return { error: failure(400, "invalid", "That is not a link.") };
  }
  url.hash = "";
  return { query: new URLSearchParams({ link: url.toString() }).toString() };
}

async function byFeedUrl(url: string, deps: ResolveDeps): Promise<ShowRow | null> {
  return feedOf(await deps.index("/podcasts/byfeedurl", { url }), deps);
}

function feedOf(body: unknown, deps: ResolveDeps): ShowRow | null {
  const feed = (body as Raw | null)?.feed;
  // The index answers an unknown show with an empty list in place of the feed.
  if (!feed || typeof feed !== "object" || Array.isArray(feed)) return null;
  const show = showFromIndex(feed as Raw, deps.sign);
  return show && show.id !== null ? show : null;
}

/**
 * The page's text and the address it was read at after any redirect, or null when it could not be
 * read within the caps.
 */
async function readPage(
  url: string,
  deps: ResolveDeps,
): Promise<{ text: string; url: string } | null> {
  try {
    const response = await guardedFetch(deps.fetch, deps.resolve ?? resolveAll)(url, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.5",
        "User-Agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readCapped(response, PAGE_MAX_BYTES);
    return bytes ? { text: new TextDecoder().decode(bytes), url: response.url || url } : null;
  } catch {
    return null;
  }
}

/** Only the start of a page is read for its tags: what names a show sits in its head or channel. */
export const PARSE_MAX_CHARS = 64 * 1024;

/** Entities and CDATA taken off; display text is cut at 300, an address (`ADDRESS_MAX`) is not. */
const decode = (text: string, max = 300): string =>
  plainText(text.split("<![CDATA[").join("").split("]]>").join(""), max);
const ADDRESS_MAX = 2048;

/**
 * The text of the first <tag>...</tag>, found by plain scans, never a backtracking pattern: a
 * hostile page must not cost the function seconds (Fable review, 27 Nov).
 */
function tagText(xml: string, tag: string, max?: number): string | null {
  const lower = xml.toLowerCase();
  let at = 0;
  for (;;) {
    at = lower.indexOf(`<${tag}`, at);
    if (at === -1) return null;
    const next = lower[at + tag.length + 1] ?? "";
    if (next === ">" || /\s/.test(next)) break;
    at += tag.length + 1;
  }
  const open = lower.indexOf(">", at);
  const close = lower.indexOf(`</${tag}>`, open);
  if (open === -1 || close === -1) return null;
  return decode(xml.slice(open + 1, close), max) || null;
}

/** Where a tag that opens at `from` ends: its first ">" outside a quoted value, or -1. */
function tagEnd(html: string, from: number): number {
  let quote = "";
  for (let i = from; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return i;
  }
  return -1;
}

/** Every <name ...> tag, by plain scans; a ">" inside a quoted value does not end one. */
function tagsNamed(html: string, name: string): string[] {
  const lower = html.toLowerCase();
  const tags: string[] = [];
  let at = lower.indexOf(`<${name}`);
  while (at !== -1 && tags.length < 400) {
    const end = tagEnd(html, at);
    if (end === -1) break;
    tags.push(html.slice(at, end + 1));
    at = lower.indexOf(`<${name}`, end);
  }
  return tags;
}

const attr = (tag: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+))`, "i")
    .exec(tag)
    ?.slice(1)
    .find((value) => value !== undefined) ?? null;

/** What a feed says about itself: its guid, where it moved, its title. */
export function readFeed(xml: string): {
  guid: string | null;
  moved: string | null;
  name: string | null;
} {
  const text = xml.slice(0, PARSE_MAX_CHARS);
  const lower = text.toLowerCase();
  const start = Math.max(0, lower.indexOf("<channel"));
  const ends = [lower.indexOf("<item", start), lower.indexOf("</channel>", start)].filter(
    (at) => at !== -1,
  );
  const channel = text.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
  const guid = tagText(channel, "podcast:guid");
  const moved = tagText(channel, "itunes:new-feed-url", ADDRESS_MAX + 1);
  return {
    guid: guid && /^[\w.:-]{1,200}$/.test(guid) ? guid : null,
    moved: moved && moved.length <= ADDRESS_MAX && /^https?:\/\//i.test(moved) ? moved : null,
    name: tagText(channel, "title"),
  };
}

/** Names the big apps add to a show's page title, taken off before searching. */
const TITLE_TAILS =
  /\s*[|\-\u2013·:]\s*(?:podcast on spotify|spotify|youtube|apple podcasts|pocket casts|castro|overcast|podcast addict|player\.fm|listen notes|podchaser|amazon music|audible|iheart(?:radio)?|podcast)\s*$/i;

/** What a web page says about a show: the feeds it lists, the Apple ids it links to, its name. */
export function readShowPage(
  html: string,
  base: string,
): { feeds: string[]; apple: string[]; name: string | null } {
  const head = html.slice(0, PARSE_MAX_CHARS);
  const feeds: string[] = [];
  for (const tag of tagsNamed(head, "link")) {
    const type = attr(tag, "type") ?? "";
    const rel = attr(tag, "rel") ?? "";
    const href = attr(tag, "href");
    if (
      !href ||
      href.length > ADDRESS_MAX ||
      !/alternate/i.test(rel) ||
      !/(rss|atom)\+xml/i.test(type)
    ) {
      continue;
    }
    try {
      feeds.push(new URL(decode(href, ADDRESS_MAX), base).toString());
    } catch {
      // A broken href is skipped.
    }
  }
  const apple = [
    ...head.matchAll(
      /podcasts\.apple\.com\/[\w-]{0,8}\/?podcast\/(?:[^"'\s<>/]{1,200}\/)?id(\d{1,12})/gi,
    ),
  ].map((match) => match[1] as string);
  let name: string | null = null;
  for (const tag of tagsNamed(head, "meta")) {
    if (/(?:property|name)\s*=\s*["'](?:og:title|twitter:title)["']/i.test(tag)) {
      name = decode(attr(tag, "content") ?? "") || null;
      if (name) break;
    }
  }
  name ??= tagText(head, "title");
  for (let i = 0; name && i < 3; i++) name = name.replace(TITLE_TAILS, "").trim();
  return {
    feeds: [...new Set(feeds)].slice(0, ALTERNATES_MAX),
    apple: [...new Set(apple)].slice(0, ALTERNATES_MAX),
    name: name ? name.slice(0, 200) : null,
  };
}

/** An index call that answers null on any failure, so one bad step falls through to the next. */
async function quietly<T>(work: () => Promise<T | null>): Promise<T | null> {
  try {
    return await work();
  } catch {
    return null;
  }
}

const found = (show: ShowRow): ApiResult<ResolveBody> => ({
  status: 200,
  body: { show, matches: [], name: null },
  headers: edgeHeaders(EDGE_SECONDS.search),
});

const several = (shows: ShowRow[], name: string | null): ApiResult<ResolveBody> => ({
  status: 200,
  body: { show: null, matches: shows.slice(0, MATCHES_MAX), name },
  headers: edgeHeaders(EDGE_SECONDS.search),
});

export async function resolveLink(
  params: URLSearchParams,
  deps: ResolveDeps,
): Promise<ApiResult<ResolveBody | ErrorBody>> {
  const url = new URL(params.get("link") ?? "");
  const https = url.protocol === "http:" ? `https:${url.href.slice(5)}` : url.href;
  // 1. A feed the index knows, as given or over https.
  const asked = new Set([url.href, https]);
  for (const candidate of asked) {
    const show = await quietly(() => byFeedUrl(candidate, deps));
    if (show) return found(show);
  }
  // 2. The page itself.
  // Over https first; a host with no TLS is read as given.
  const page =
    (await readPage(https, deps)) ?? (https !== url.href ? await readPage(url.href, deps) : null);
  const text = page?.text ?? null;
  // A feed that redirected may be known by where it landed (a host move, a short link).
  if (page && !asked.has(page.url)) {
    const show = await quietly(() => byFeedUrl(page.url, deps));
    if (show) return found(show);
  }
  let name: string | null = null;
  if (text && /<(?:rss|feed)[\s>]/i.test(text.slice(0, 4000))) {
    const feed = readFeed(text);
    const guid = feed.guid;
    if (guid) {
      const show = await quietly(async () =>
        feedOf(await deps.index("/podcasts/byguid", { guid }), deps),
      );
      if (show) return found(show);
    }
    const moved = feed.moved;
    if (moved) {
      const show = await quietly(() => byFeedUrl(moved, deps));
      if (show) return found(show);
    }
    name = feed.name;
  } else if (text) {
    // A page that links one show names it; one that links several (an article, a list) does not,
    // so those are offered to pick from, never followed on a guess.
    const listed = readShowPage(text, page?.url ?? https);
    const shows = new Map<number, ShowRow>();
    // A link the index did not answer for may be another show: then the one found is offered, not
    // followed on its own.
    let unknown = 0;
    for (const feed of listed.feeds) {
      const show = await quietly(() => byFeedUrl(feed, deps));
      if (show?.id) shows.set(show.id, show);
      else unknown += 1;
    }
    for (const id of listed.apple) {
      const show = await quietly(async () =>
        feedOf(await deps.index("/podcasts/byitunesid", { id }), deps),
      );
      if (show?.id) shows.set(show.id, show);
      else unknown += 1;
    }
    if (shows.size === 1 && unknown === 0) return found([...shows.values()][0] as ShowRow);
    if (shows.size === 1) return several([...shows.values()], listed.name);
    if (shows.size > 1) return several([...shows.values()], listed.name);
    name = listed.name;
  }
  // 3. The closest shows by the page's name. A failed search is the search's answer, never kept.
  if (!name) return failure(404, "not_found", "Nothing on that page names a show.");
  // Index only: an Apple row has no index id to follow, and Apple's search cap is shared by everyone.
  const search = await searchShows(name.toLowerCase().slice(0, 100), deps, false);
  if (!("shows" in search.body)) return search as ApiResult<ErrorBody>;
  const matches = search.body.shows.filter((show) => show.id !== null);
  if (matches.length === 0) return failure(404, "not_found", "No show goes by that page's name.");
  return several(matches, name);
}
