import { createHash } from "node:crypto";
import { coverAddress, extrasAddress, type Signer } from "./signing";

/**
 * What the podcast routes answer: the few fields a list or a page draws, trimmed from Podcast
 * Index and Apple answers (a show's feed can be megabytes). Persisted on the device later, so every
 * field is snake_case. Covers, transcripts and chapters are our own signed addresses (signing.ts).
 */

export interface ShowRow {
  /** Podcast Index feed id; null for a show only Apple found. */
  id: number | null;
  apple_id: number | null;
  title: string;
  author: string;
  feed_url: string;
  cover: string | null;
  categories: string[];
  episode_count: number | null;
  /** ISO time of the newest episode, when known. */
  newest_at: string | null;
  source: "index" | "apple";
}

export interface ShowDetail extends ShowRow {
  description: string;
  link: string | null;
  language: string | null;
  explicit: boolean;
}

export interface EpisodeRow {
  /** `pe:<feed id>:<hash>`, so it never collides with a Catchup's date id. Stable per episode. */
  id: string;
  show_id: number;
  show_title: string;
  guid: string;
  title: string;
  published_at: string | null;
  duration_s: number | null;
  /** Always https. When the publisher gave http, this is the https guess and `audio_insecure` is set. */
  audio_url: string;
  audio_insecure: boolean;
  audio_type: string | null;
  audio_bytes: number | null;
  cover: string | null;
  description: string;
  link: string | null;
  season: number | null;
  episode: number | null;
  transcript: string | null;
  chapters: string | null;
}

export const DESCRIPTION_MAX = 4000;

type Raw = Record<string, unknown>;

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const iso = (seconds: unknown): string | null => {
  const value = num(seconds);
  return value === null ? null : new Date(value * 1000).toISOString();
};
const httpUrl = (value: unknown): string | null => {
  const text = str(value);
  return /^https?:\/\//i.test(text) ? text : null;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Show notes as plain text: paragraphs kept as blank lines, tags dropped, entities decoded. */
export function plainText(html: string, max = DESCRIPTION_MAX): string {
  const text = html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code =
          name[1] === "x" || name[1] === "X"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : "";
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The episode's id: its show and a hash of its guid (or audio address when it has none). */
export function episodeId(showId: number, guid: string): string {
  return `pe:${showId}:${createHash("sha256").update(guid).digest("hex").slice(0, 16)}`;
}

function categories(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value as Raw).filter((name): name is string => typeof name === "string");
}

/** A Podcast Index feed (search, trending, byfeedid) as a row. Null when it has no id or address. */
export function showFromIndex(feed: Raw, sign: Signer): ShowRow | null {
  const id = num(feed.id);
  const url = httpUrl(feed.url);
  if (id === null || url === null) return null;
  return {
    id,
    apple_id: num(feed.itunesId),
    title: str(feed.title) || "Untitled show",
    author: str(feed.author) || str(feed.ownerName),
    feed_url: url,
    cover: coverAddress(sign, httpUrl(feed.artwork) ?? httpUrl(feed.image)),
    categories: categories(feed.categories),
    episode_count: num(feed.episodeCount),
    newest_at: iso(feed.newestItemPubdate ?? feed.newestItemPublishTime),
    source: "index",
  };
}

export function showDetailFromIndex(feed: Raw, sign: Signer): ShowDetail | null {
  const row = showFromIndex(feed, sign);
  if (!row) return null;
  return {
    ...row,
    description: plainText(str(feed.description)),
    link: httpUrl(feed.link),
    language: str(feed.language) || null,
    explicit: feed.explicit === true,
  };
}

/** An Apple search result as a row. Null without a feed address: we cannot play it. */
export function showFromApple(result: Raw, sign: Signer): ShowRow | null {
  const url = httpUrl(result.feedUrl);
  if (url === null) return null;
  const genre = str(result.primaryGenreName);
  return {
    id: null,
    apple_id: num(result.collectionId),
    title: str(result.collectionName) || "Untitled show",
    author: str(result.artistName),
    feed_url: url,
    cover: coverAddress(sign, httpUrl(result.artworkUrl600) ?? httpUrl(result.artworkUrl100)),
    categories: genre ? [genre] : [],
    episode_count: num(result.trackCount),
    newest_at: typeof result.releaseDate === "string" ? result.releaseDate : null,
    source: "apple",
  };
}

const TRANSCRIPT_KINDS = [
  ["application/json", "transcript:json"],
  ["text/vtt", "transcript:vtt"],
  ["application/srt", "transcript:srt"],
  ["text/srt", "transcript:srt"],
  ["application/x-subrip", "transcript:srt"],
] as const;

/** The best timed transcript an episode lists: JSON, then WebVTT, then SRT. Untimed text cannot place a skip. */
function transcriptOf(item: Raw, sign: Signer): string | null {
  const listed = Array.isArray(item.transcripts) ? (item.transcripts as Raw[]) : [];
  for (const [type, kind] of TRANSCRIPT_KINDS) {
    const match = listed.find((entry) => str(entry.type).toLowerCase() === type);
    const url = match ? httpUrl(match.url) : null;
    if (url) return extrasAddress(sign, kind, url);
  }
  const single = httpUrl(item.transcriptUrl);
  if (!single) return null;
  const extension = /\.(json|vtt|srt)(?:[?#]|$)/i.exec(single)?.[1]?.toLowerCase();
  return extension
    ? extrasAddress(sign, `transcript:${extension}` as "transcript:json", single)
    : null;
}

/** A Podcast Index episode as a row. Null without audio: nothing to play. */
export function episodeFromIndex(item: Raw, sign: Signer): EpisodeRow | null {
  const showId = num(item.feedId);
  const audio = httpUrl(item.enclosureUrl);
  if (showId === null || audio === null) return null;
  const guid = str(item.guid) || audio;
  const chapters = httpUrl(item.chaptersUrl);
  const insecure = /^http:/i.test(audio);
  return {
    id: episodeId(showId, guid),
    show_id: showId,
    show_title: str(item.feedTitle),
    guid,
    title: str(item.title) || "Untitled episode",
    published_at: iso(item.datePublished),
    duration_s: num(item.duration),
    audio_url: insecure ? audio.replace(/^http:/i, "https:") : audio,
    audio_insecure: insecure,
    audio_type: str(item.enclosureType) || null,
    audio_bytes: num(item.enclosureLength),
    cover: coverAddress(sign, httpUrl(item.image) ?? httpUrl(item.feedImage)),
    description: plainText(str(item.description)),
    link: httpUrl(item.link),
    season: num(item.season),
    episode: num(item.episode),
    transcript: transcriptOf(item, sign),
    chapters: chapters ? extrasAddress(sign, "chapters", chapters) : null,
  };
}

/** Rows without repeats, by feed address then Apple id; the first one stands. */
export function uniqueShows(rows: readonly ShowRow[]): ShowRow[] {
  const seen = new Set<string>();
  const out: ShowRow[] = [];
  for (const row of rows) {
    const keys = [
      `u:${row.feed_url
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "")
        .toLowerCase()}`,
      ...(row.apple_id === null ? [] : [`a:${row.apple_id}`]),
    ];
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) seen.add(key);
    out.push(row);
  }
  return out;
}
