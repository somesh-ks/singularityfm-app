import type { EpisodeRow } from "../server/podcasts/shapes";
import type { Heard } from "./rules";

/**
 * What a show's page and an episode's page say of an episode: its day, its length, how much is left
 * and its notes. Pure, so a row, a header and a test read the same words.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

const dayOf = (date: Date): number =>
  Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);

/** "Today", "Yesterday", "24 Nov", and the year once it is not this one. Empty with no date. */
export function dayLabel(iso: string | null, now: Date): string {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return "";
  const days = dayOf(now) - dayOf(at);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const day = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === now.getFullYear() ? day : `${day} ${at.getFullYear()}`;
}

/** "42 min", "1 hr 5 min"; never under a minute. */
export function lengthLabel(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} hr ${rest} min` : `${Math.floor(minutes / 60)} hr`;
}

/**
 * The row's second fact: what is left of a half heard episode, else its length, else nothing (a
 * feed that gives no length says nothing rather than "0 min").
 */
export function timeFact(durationSeconds: number | null, heard: Heard): string {
  const total = durationSeconds ?? 0;
  if (!(total > 0)) return "";
  if (heard.seconds > 0 && !heard.played) return `${lengthLabel(total - heard.seconds)} left`;
  return lengthLabel(total);
}

/** Whether every word typed is in the episode's title or notes, in any order and any case. */
export function matchesSearch(
  episode: Pick<EpisodeRow, "title" | "description">,
  query: string,
): boolean {
  const text = `${episode.title} ${episode.description}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}

export type NotePart = { text: string; href?: string };

const ADDRESS = /https?:\/\/[^\s<>"')\]]+/g;

/**
 * Notes as paragraphs of words and links. The routes send notes as plain text with each link's
 * address kept (`words (https://...)`), so the page never places a publisher's markup: only an
 * http or https address becomes a link, and everything else stays words.
 */
export function noteParagraphs(notes: string): NotePart[][] {
  return notes
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const parts: NotePart[] = [];
      let from = 0;
      for (const match of paragraph.matchAll(ADDRESS)) {
        // A sentence's own full stop or comma after an address is not part of it.
        const address = match[0].replace(/[.,;:!?]+$/, "");
        const at = match.index;
        if (at > from) parts.push({ text: paragraph.slice(from, at) });
        parts.push({ text: address.replace(/^https?:\/\/(www\.)?/, ""), href: address });
        from = at + address.length;
      }
      if (from < paragraph.length) parts.push({ text: paragraph.slice(from) });
      return parts;
    });
}
