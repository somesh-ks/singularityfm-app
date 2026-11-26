import type { ApiResult } from "../http";
import { readCapped } from "../siteIcon";
import { type FetchImpl, guardedFetch, type Resolver, resolveAll } from "../sourcePreview";
import { USER_AGENT } from "./podcastIndex";
import { failure, NEVER_KEPT } from "./routes";
import { stripTags } from "./shapes";
import { type SignedKind, type Signer, verifySigned } from "./signing";

/**
 * The two routes that fetch a publisher's file: a show's cover, resized and turned to WebP, and an
 * episode's transcript or chapters, tidied to the fields the player needs. Each takes only an address
 * our own answers signed (signing.ts), fetches it through the outbound guard (https, public addresses,
 * every redirect checked), within a size and time cap, and is kept at the edge for a year: the address
 * names the file.
 */

export const COVER_WIDTHS = [128, 256, 512] as const;
export type CoverWidth = (typeof COVER_WIDTHS)[number];
export const COVER_MAX_BYTES = 10 * 1024 * 1024;
/** Publishers ship covers up to 3000 pixels square; past this a file is refused before decoding. */
export const COVER_MAX_PIXELS = 25_000_000;
export const EXTRAS_MAX_BYTES = 5 * 1024 * 1024;
export const FILE_TIMEOUT_MS = 5000;

const DAY = 86_400;
/** Bounded, not immutable: a publisher can replace a cover or fix a transcript at the same address,
   and the signature vouches for the address, not the bytes. */
const KEPT_A_MONTH = {
  "Cache-Control": `public, max-age=${DAY}, stale-while-revalidate=${7 * DAY}`,
  "Vercel-CDN-Cache-Control": `max-age=${30 * DAY}, stale-while-revalidate=${7 * DAY}`,
};

export interface FileDeps {
  fetch: FetchImpl;
  sign: Signer;
  resolve?: Resolver;
  timeoutMs?: number;
  /** Replaced in tests. */
  resize?: (bytes: Uint8Array, width: CoverWidth) => Promise<Uint8Array>;
}

type Checked = { url: string } | { error: ApiResult<{ error: string; message: string }> };

function checkSigned(params: URLSearchParams, kind: SignedKind, sign: Signer): Checked {
  const url = params.get("u");
  const signature = params.get("s");
  if (!url || !signature) return { error: failure(400, "invalid", "Missing address.") };
  if (!verifySigned(sign, kind, url, signature)) {
    return { error: failure(403, "invalid", "That address was not issued here.") };
  }
  return { url };
}

async function fetchCapped(
  url: string,
  accept: string,
  limit: number,
  deps: FileDeps,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    const response = await guardedFetch(deps.fetch, deps.resolve ?? resolveAll)(url, {
      headers: { Accept: accept, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(deps.timeoutMs ?? FILE_TIMEOUT_MS),
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > limit) {
      await response.body?.cancel();
      return null;
    }
    const bytes = await readCapped(response, limit);
    return bytes && bytes.byteLength > 0
      ? { bytes, type: response.headers.get("content-type") ?? "" }
      : null;
  } catch {
    return null;
  }
}

const defaultResize = async (bytes: Uint8Array, width: CoverWidth): Promise<Uint8Array> => {
  // Loaded on use: sharp adds to every cold start otherwise (lib/covers.ts).
  const { default: sharp } = await import("sharp");
  return new Uint8Array(
    await sharp(bytes, { limitInputPixels: COVER_MAX_PIXELS })
      .rotate()
      .resize(width, width, { fit: "cover" })
      .webp({ quality: 78 })
      .toBuffer(),
  );
};

/** GET /api/podcasts/cover?u=&s=&w=: the cover at one of three widths, as WebP. */
export async function coverFile(params: URLSearchParams, deps: FileDeps): Promise<Response> {
  const checked = checkSigned(params, "cover", deps.sign);
  if ("error" in checked) return json(checked.error);
  const width = Number(params.get("w") ?? 512);
  if (!COVER_WIDTHS.includes(width as CoverWidth)) {
    return json(failure(400, "invalid", "Ask for width 128, 256 or 512."));
  }
  const file = await fetchCapped(checked.url, "image/*", COVER_MAX_BYTES, deps);
  if (!file || !/^image\//i.test(file.type)) {
    return json(failure(404, "not_found", "The cover could not be read."));
  }
  try {
    const webp = await (deps.resize ?? defaultResize)(file.bytes, width as CoverWidth);
    return new Response(webp as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
        ...KEPT_A_MONTH,
      },
    });
  } catch {
    // Not an image sharp can read, or too large: the page draws its letter.
    return json(failure(404, "not_found", "The cover could not be read."));
  }
}

// ------------------------------------------------------------------------------------ the extras

export interface TranscriptSegment {
  start_s: number;
  end_s: number;
  text: string;
  speaker: string | null;
}

export interface Chapter {
  start_s: number;
  title: string;
  url: string | null;
}

export const MAX_SEGMENTS = 20_000;
export const MAX_CHAPTERS = 500;

/** `01:02:03,456`, `02:03.456` or `3.5` as seconds; NaN when it is none of them. */
export function clockSeconds(text: string): number {
  const match = /^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2}(?:[.,]\d+)?)$/.exec(text.trim());
  if (!match) return Number.NaN;
  const [, a, b, c] = match;
  const seconds = Number((c ?? "").replace(",", "."));
  if (a !== undefined && b !== undefined) return Number(a) * 3600 + Number(b) * 60 + seconds;
  if (a !== undefined) return Number(a) * 60 + seconds;
  return seconds;
}

const CUE = /^\s*((?:\d+:)?\d{1,2}:\d{1,2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{1,2}:\d{1,2}[.,]\d+)/;

/** An SRT or WebVTT file's cues. A `<v Speaker>` voice tag names the speaker. */
export function parseCues(text: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const at = lines.findIndex((line) => CUE.test(line));
    if (at < 0) continue;
    const [, from = "", to = ""] = CUE.exec(lines[at] ?? "") ?? [];
    const raw = lines.slice(at + 1).join(" ");
    const speaker = /<v(?:\.[^ >]*)?\s+([^>]+)>/.exec(raw)?.[1]?.trim() ?? null;
    // A cue is text, never markup: tags go, and a stray `>` with them.
    const body = stripTags(raw).replace(/>/g, "").replace(/\s+/g, " ").trim();
    const start = clockSeconds(from);
    const end = clockSeconds(to);
    if (!body || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    segments.push({ start_s: start, end_s: end, text: body, speaker });
    if (segments.length >= MAX_SEGMENTS) break;
  }
  return segments;
}

type Raw = Record<string, unknown>;
/** A list entry that is an object; null, a number or an array is skipped, not read. */
const isRaw = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** A podcast-namespace JSON transcript's segments. */
export function parseJsonTranscript(body: unknown): TranscriptSegment[] {
  const list = (body as Raw | null)?.segments;
  if (!Array.isArray(list)) return [];
  const segments: TranscriptSegment[] = [];
  for (const entry of list.filter(isRaw)) {
    const start = finite(entry.startTime);
    const end = finite(entry.endTime);
    const text = typeof entry.body === "string" ? entry.body.trim() : "";
    if (start === null || end === null || end < start || !text) continue;
    const speaker =
      typeof entry.speaker === "string" && entry.speaker.trim() ? entry.speaker.trim() : null;
    segments.push({ start_s: start, end_s: end, text, speaker });
    if (segments.length >= MAX_SEGMENTS) break;
  }
  return segments;
}

/** A podcast-namespace JSON chapters file, in time order. */
export function parseChapters(body: unknown): Chapter[] {
  const list = (body as Raw | null)?.chapters;
  if (!Array.isArray(list)) return [];
  return list
    .filter(isRaw)
    .filter((entry) => entry.toc !== false)
    .map((entry) => ({
      start_s: finite(entry.startTime) ?? Number.NaN,
      title: typeof entry.title === "string" ? entry.title.trim() : "",
      url: typeof entry.url === "string" && /^https:\/\//i.test(entry.url) ? entry.url : null,
    }))
    .filter((chapter) => Number.isFinite(chapter.start_s) && chapter.title !== "")
    .sort((a, b) => a.start_s - b.start_s)
    .slice(0, MAX_CHAPTERS);
}

const EXTRAS_KINDS = ["transcript:json", "transcript:vtt", "transcript:srt", "chapters"] as const;

/** GET /api/podcasts/extras?k=&u=&s=: a transcript's timed segments, or a chapters list. */
export async function extrasFile(params: URLSearchParams, deps: FileDeps): Promise<Response> {
  const kind = params.get("k") as (typeof EXTRAS_KINDS)[number] | null;
  if (!kind || !EXTRAS_KINDS.includes(kind))
    return json(failure(400, "invalid", "Unknown file kind."));
  const checked = checkSigned(params, kind, deps.sign);
  if ("error" in checked) return json(checked.error);
  const file = await fetchCapped(checked.url, "*/*", EXTRAS_MAX_BYTES, deps);
  if (!file) return json(failure(502, "upstream", "The publisher's file could not be read."));
  const text = new TextDecoder().decode(file.bytes);
  let body: unknown;
  try {
    if (kind === "transcript:vtt" || kind === "transcript:srt") {
      body = { segments: parseCues(text) };
    } else {
      const parsed: unknown = JSON.parse(text);
      body =
        kind === "chapters"
          ? { chapters: parseChapters(parsed) }
          : { segments: parseJsonTranscript(parsed) };
    }
  } catch {
    return json(failure(502, "upstream", "The publisher's file is not readable."));
  }
  return json({ status: 200, body, headers: KEPT_A_MONTH });
}

const json = (result: ApiResult<unknown>): Response =>
  new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...NEVER_KEPT,
      ...result.headers,
    },
  });
