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
import { type ShowRow, showFromIndex, stripTags } from "./shapes";

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

/** The page's text, or null when it could not be read within the caps. */
async function readPage(url: string, deps: ResolveDeps): Promise<string | null> {
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
    return bytes ? new TextDecoder().decode(bytes) : null;
  } catch {
    return null;
  }
}

const decode = (text: string): string =>
  stripTags(text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim();

const tagText = (xml: string, tag: string): string | null => {
  const found = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml)?.[1];
  return found ? decode(found) || null : null;
};

const attr = (tag: string, name: string): string | null =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
    .exec(tag)
    ?.slice(1)
    .find((value) => value !== undefined) ?? null;

/** What a feed says about itself: its guid, where it moved, its title. */
export function readFeed(xml: string): {
  guid: string | null;
  moved: string | null;
  name: string | null;
} {
  const channel = /<channel[\s>]([\s\S]*?)(?:<item[\s>]|<\/channel>)/i.exec(xml)?.[1] ?? xml;
  return {
    guid: tagText(channel, "podcast:guid"),
    moved: tagText(channel, "itunes:new-feed-url"),
    name: tagText(channel, "title"),
  };
}

/** Names the big apps add to a show's page title, taken off before searching. */
const TITLE_TAILS =
  /\s*[|\-\u2013·:]\s*(?:podcast on spotify|spotify|youtube|apple podcasts|pocket casts|castro|overcast|podcast addict|player\.fm|listen notes|podchaser|amazon music|audible|iheart(?:radio)?|podcast)\s*$/i;

/** What a web page says about a show: the feeds it lists, an Apple id it links to, its name. */
export function readShowPage(
  html: string,
  base: string,
): { feeds: string[]; apple: string | null; name: string | null } {
  const head = html.slice(0, 200_000);
  const feeds: string[] = [];
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const type = attr(tag, "type") ?? "";
    const rel = attr(tag, "rel") ?? "";
    const href = attr(tag, "href");
    if (!href || !/alternate/i.test(rel) || !/(rss|atom)\+xml/i.test(type)) continue;
    try {
      feeds.push(new URL(decode(href), base).toString());
    } catch {
      // A broken href is skipped.
    }
  }
  const apple = /podcasts\.apple\.com\/[^"'\s<>]*?\/id(\d{1,12})/i.exec(head)?.[1] ?? null;
  let name: string | null = null;
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    if (/(?:property|name)\s*=\s*["'](?:og:title|twitter:title)["']/i.test(tag)) {
      name = decode(attr(tag, "content") ?? "") || null;
      if (name) break;
    }
  }
  name ??= tagText(head, "title");
  for (let i = 0; name && i < 3; i++) name = name.replace(TITLE_TAILS, "").trim();
  return { feeds: [...new Set(feeds)].slice(0, ALTERNATES_MAX), apple, name: name || null };
}

const found = (show: ShowRow): ApiResult<ResolveBody> => ({
  status: 200,
  body: { show, matches: [], name: null },
  headers: edgeHeaders(EDGE_SECONDS.search),
});

export async function resolveLink(
  params: URLSearchParams,
  deps: ResolveDeps,
): Promise<ApiResult<ResolveBody | ErrorBody>> {
  const link = params.get("link") ?? "";
  try {
    const url = new URL(link);
    const https = url.protocol === "http:" ? `https:${url.href.slice(5)}` : url.href;
    // 1. A feed the index knows, as given or over https.
    for (const candidate of new Set([url.href, https])) {
      const show = await byFeedUrl(candidate, deps);
      if (show) return found(show);
    }
    // 2. The page itself.
    const text = await readPage(https, deps);
    let name: string | null = null;
    if (text && /<(?:rss|feed)[\s>]/i.test(text.slice(0, 4000))) {
      const feed = readFeed(text);
      if (feed.guid) {
        const show = feedOf(await deps.index("/podcasts/byguid", { guid: feed.guid }), deps);
        if (show) return found(show);
      }
      if (feed.moved && /^https?:\/\//i.test(feed.moved)) {
        const show = await byFeedUrl(feed.moved, deps);
        if (show) return found(show);
      }
      name = feed.name;
    } else if (text) {
      const page = readShowPage(text, https);
      for (const feed of page.feeds) {
        const show = await byFeedUrl(feed, deps);
        if (show) return found(show);
      }
      if (page.apple) {
        const show = feedOf(await deps.index("/podcasts/byitunesid", { id: page.apple }), deps);
        if (show) return found(show);
      }
      name = page.name;
    }
    // 3. The closest shows by the page's name.
    if (!name) return failure(404, "not_found", "Nothing on that page names a show.");
    const search = await searchShows(name.toLowerCase().slice(0, 100), deps);
    const matches = "shows" in search.body ? search.body.shows.slice(0, MATCHES_MAX) : [];
    return {
      status: 200,
      body: { show: null, matches, name },
      headers: edgeHeaders(EDGE_SECONDS.search),
    };
  } catch {
    return failure(502, "upstream", "The podcast index did not answer.");
  }
}
