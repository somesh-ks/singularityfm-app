import type { Chapter, TranscriptSegment } from "../server/podcasts/files";
import type { PlayerDigestData, PlayerItem, PlayerTurn } from "../types/contracts";
import { findSponsorBreaks, type SponsorBreak } from "./sponsors";

/**
 * A public show's episode extras: the publisher's chapters and timed transcript, read through our
 * extras route (it fetches and tidies them; a publisher's file rarely lets a page read it), and the
 * sponsor breaks found in them. The shaping is pure, so the episode page, the player and the tests
 * read the same rows.
 */

export interface EpisodeExtras {
  chapters: Chapter[];
  segments: TranscriptSegment[];
  /** A file could not be reached (offline): what came back is incomplete, so ask again later. */
  partial?: true;
}

export interface ChapterRow {
  start_s: number;
  title: string;
  url: string | null;
  /** A sponsor break: the publisher's own "Sponsor: …" chapter, or one the transcript shows. */
  sponsor: boolean;
}

/** What a break the transcript found is called in a list of chapters. */
export const SPONSOR_ROW = "Sponsor break";

/**
 * A publisher's chapter that is an ad: "Sponsor: Deepgram", "Ad break", "Ads", "Sponsored by Acme".
 * The word alone must end the title or meet a separator: "Ad hoc teams" and "Advertising after
 * cookies" are the show, and a skip over them would cut it.
 */
const SPONSOR_CHAPTER =
  /^\s*(?:(?:sponsors?|sponsored(?:\s+by)?|ads?|ad break|advert(?:isement)?|commercial break)\s*(?:[:\u00b7\u2013-]|$)|sponsored by\b|a word from (?:our|this|today'?s) sponsors?\b)/i;

/** A break split off a chapter leaves this much of the chapter after it, or it is not listed again. */
const MIN_REST_S = 5;

export function isSponsorChapter(title: string): boolean {
  return SPONSOR_CHAPTER.test(title);
}

/** A publisher's "Sponsor:" or "Ad break -" before the sponsor's name. */
const SPONSOR_PREFIX =
  /^\s*(?:sponsor(?:ed)?(?:\s+by)?|ads?|ad break|advert)\s*[:\u00b7\u2013-]\s*/i;

/**
 * A row's name beside the Sponsor badge (episode page): the badge says sponsor, so the name does
 * not say it again ("Sponsor: ClickHouse" reads "ClickHouse"), and a break the transcript found
 * says where it came from.
 */
export function badgedTitle(row: Pick<ChapterRow, "title" | "sponsor">): string {
  if (!row.sponsor) return row.title;
  if (row.title === SPONSOR_ROW) return "Found in the transcript";
  return row.title.replace(SPONSOR_PREFIX, "") || row.title;
}

/** Breaks in time order with overlapping or touching ones joined. */
function joined(spans: readonly SponsorBreak[]): SponsorBreak[] {
  const sorted = [...spans].sort((a, b) => a.start_s - b.start_s);
  const out: SponsorBreak[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.start_s <= last.end_s + 1) last.end_s = Math.max(last.end_s, span.end_s);
    else out.push({ ...span });
  }
  return out;
}

/**
 * Every sponsor break of an episode: the publisher's sponsor chapters (each runs to the next
 * chapter, or to the end) and the ones its transcript shows.
 */
export function episodeBreaks(extras: EpisodeExtras, durationS: number): SponsorBreak[] {
  const fromChapters = extras.chapters.flatMap((chapter, index) => {
    if (!isSponsorChapter(chapter.title)) return [];
    const end = extras.chapters[index + 1]?.start_s ?? durationS;
    return end > chapter.start_s ? [{ start_s: chapter.start_s, end_s: end }] : [];
  });
  // A last chapter with no known end (no length in the feed) is no break: a skip needs a place to land.
  return joined([...fromChapters, ...findSponsorBreaks(extras.segments)]).filter((span) =>
    Number.isFinite(span.end_s),
  );
}

/**
 * The chapters list with its sponsor breaks in place (canvas, Episode board): a break the transcript
 * found inside a chapter splits it, and the chapter's name comes back after the break when enough of
 * it is left. Empty when the publisher gave no chapters: breaks alone are no list of chapters.
 */
export function chapterRows(
  chapters: readonly Chapter[],
  breaks: readonly SponsorBreak[],
  durationS: number,
): ChapterRow[] {
  if (chapters.length === 0) return [];
  const rows: ChapterRow[] = [];
  chapters.forEach((chapter, index) => {
    const end = chapters[index + 1]?.start_s ?? durationS;
    if (isSponsorChapter(chapter.title)) {
      rows.push({
        start_s: chapter.start_s,
        title: chapter.title,
        url: chapter.url,
        sponsor: true,
      });
      return;
    }
    const part = (start_s: number): ChapterRow => ({
      start_s,
      title: chapter.title,
      url: chapter.url,
      sponsor: false,
    });
    const inside = breaks.filter((span) => span.start_s >= chapter.start_s && span.start_s < end);
    if (inside.length === 0) {
      rows.push(part(chapter.start_s));
      return;
    }
    let from = chapter.start_s;
    for (const span of inside) {
      if (span.start_s - from >= 1) rows.push(part(from));
      rows.push({ start_s: span.start_s, title: SPONSOR_ROW, url: null, sponsor: true });
      from = Math.max(from, span.end_s);
    }
    if (end - from >= MIN_REST_S) rows.push(part(from));
  });
  return rows;
}

/** A transcript's line names nobody when its speaker is only a number ("SPEAKER_01", "Speaker 2"). */
const UNNAMED = /^(?:speaker|spk|s)[\s_-]*\d+$/i;
/** A turn gathers one speaker's lines up to about this long, so the list stays a few hundred rows. */
const TURN_MAX_S = 45;

/**
 * The transcript as the player's turns: one speaker's consecutive lines gathered into a turn. The
 * first voice is drawn as the lead and every other as the guest (ScriptView's two tones); a speaker
 * the publisher names is shown by name where the voice changes.
 */
export function transcriptTurns(segments: readonly TranscriptSegment[]): PlayerTurn[] {
  const turns: PlayerTurn[] = [];
  const order: string[] = [];
  let open: { turn: PlayerTurn; speaker: string | null; start: number } | null = null;
  for (const segment of segments) {
    const speaker = segment.speaker;
    if (speaker !== null && !order.includes(speaker)) order.push(speaker);
    const same =
      open !== null && open.speaker === speaker && segment.end_s - open.start <= TURN_MAX_S;
    if (open && same) {
      open.turn.text = `${open.turn.text} ${segment.text}`;
      open.turn.end_ms = Math.round(segment.end_s * 1000);
      continue;
    }
    const turn: PlayerTurn = {
      key: `x${turns.length}`,
      speaker: speaker !== null && order.indexOf(speaker) > 0 ? "b" : "a",
      text: segment.text,
      start_ms: Math.round(segment.start_s * 1000),
      end_ms: Math.round(segment.end_s * 1000),
      ...(speaker !== null && !UNNAMED.test(speaker) ? { name: speaker } : {}),
    };
    turns.push(turn);
    open = { turn, speaker, start: segment.start_s };
  }
  return turns;
}

/** The section every chapter sits in: one, so the list needs no heading (StoryList.tsx). */
const CHAPTERS_SECTION = "chapters";

/**
 * The episode as the player plays it once its extras are read: chapters as the timeline's items, so
 * the scrubber's breaks, the previous and next buttons and the list work as they do for a Catchup's
 * stories; the transcript as its turns; the sponsor breaks for the skip.
 */
export function withExtras(digest: PlayerDigestData, extras: EpisodeExtras): PlayerDigestData {
  const show = digest.show;
  if (!show) return digest;
  const durationS = (digest.audio?.duration_ms ?? 0) / 1000;
  const lastLine = extras.segments[extras.segments.length - 1];
  const breaks = episodeBreaks(extras, durationS || Number.POSITIVE_INFINITY);
  // The timeline places items within the feed's length; with none every chapter would sit at 0:00.
  const rows = durationS > 0 ? chapterRows(extras.chapters, breaks, durationS) : [];
  const items: PlayerItem[] = rows.map((row, index) => ({
    id: `c${index}`,
    headline: row.title,
    section: CHAPTERS_SECTION,
    source: "",
    url: row.url,
    start_ms: Math.round(row.start_s * 1000),
    end_ms: null,
  }));
  const turns = transcriptTurns(extras.segments);
  return {
    ...digest,
    show: { ...show, breaks, transcript_end_s: lastLine ? lastLine.end_s : null },
    timeline: items.length > 0 ? "marks" : digest.timeline,
    items,
    sections: items.length > 0 ? [{ slug: CHAPTERS_SECTION, title: "Chapters", start_ms: 0 }] : [],
    ...(turns.length > 0 ? { turns } : {}),
  };
}

const NONE: EpisodeExtras = { chapters: [], segments: [] };
const read = new Map<string, Promise<EpisodeExtras>>();

/** The list a file holds; [] when the route answered without one, null when it could not be reached. */
async function readList<T>(address: string | null | undefined, key: string): Promise<T[] | null> {
  if (!address) return [];
  try {
    const response = await fetch(address, { headers: { Accept: "application/json" } });
    // The route answered: a publisher's broken file stays broken, and the other file still counts.
    if (!response.ok) return [];
    const body = (await response.json()) as Record<string, unknown>;
    return Array.isArray(body[key]) ? (body[key] as T[]) : [];
  } catch {
    return null;
  }
}

/**
 * An episode's extras, read once per tab. A read that could not reach the route (offline) is not
 * remembered and comes back marked partial, so the next ask tries again; one that answered is kept.
 */
export function loadExtras(
  id: string,
  addresses: { chapters?: string | null; transcript?: string | null },
): Promise<EpisodeExtras> {
  if (!addresses.chapters && !addresses.transcript) return Promise.resolve(NONE);
  const known = read.get(id);
  if (known) return known;
  const pending = Promise.all([
    readList<Chapter>(addresses.chapters, "chapters"),
    readList<TranscriptSegment>(addresses.transcript, "segments"),
  ]).then(([chapters, segments]) => {
    if (chapters !== null && segments !== null) return { chapters, segments };
    read.delete(id);
    return { chapters: chapters ?? [], segments: segments ?? [], partial: true as const };
  });
  read.set(id, pending);
  return pending;
}
