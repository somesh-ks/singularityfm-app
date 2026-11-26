import { SKIP_BACK_SECONDS, SKIP_FORWARD_SECONDS } from "../player/core/playerTypes";
import type { EpisodeRow, ShowDetail } from "../server/podcasts/shapes";

/**
 * The rules that connect a public show's screens (flow spec, 23 Nov 2026): what an id is, when an
 * episode is played, what counts as new, what a show's Play starts and what follows an episode.
 * Pure, so the show page, the dial, the player and the tests all ask the same question once.
 */

/** A show episode's id, as the routes mint it (`pe:<feed id>:<16 hex>`): never a Catchup's date id. */
const SHOW_EPISODE_ID = /^pe:(\d+):[0-9a-f]{16}$/;

export function isShowEpisodeId(id: string): boolean {
  return SHOW_EPISODE_ID.test(id);
}

/** The show an episode id belongs to, or null for a Catchup's id. */
export function showIdOf(id: string): number | null {
  const match = SHOW_EPISODE_ID.exec(id);
  return match ? Number(match[1]) : null;
}

/** Where a show's page and an episode's page live: static shells that read the id from the query. */
export function showUrl(showId: number): string {
  return `/show?id=${showId}`;
}

export function showEpisodeUrl(id: string): string {
  return `/episode?id=${encodeURIComponent(id)}`;
}

/** A Catchup counts as finished inside its last seconds: its last minute is a real story. */
export const CATCHUP_TAIL_SECONDS = 3;
/** A show episode ends in credits and ads: its last twentieth is the tail, never more than this. */
export const SHOW_TAIL_SHARE = 0.05;
export const SHOW_TAIL_MAX_SECONDS = 180;

/**
 * Seconds from the end inside which a position counts as heard to the end. One rule for both
 * worlds, chosen by the id: without it most show episodes stay half heard for good.
 */
export function finishedTailSeconds(id: string, durationSeconds: number): number {
  if (!isShowEpisodeId(id) || !(durationSeconds > 0)) return CATCHUP_TAIL_SECONDS;
  return Math.max(
    CATCHUP_TAIL_SECONDS,
    Math.min(durationSeconds * SHOW_TAIL_SHARE, SHOW_TAIL_MAX_SECONDS),
  );
}

/** An episode that played this long was listened to: History holds it (flow spec, 23 Nov). */
export const LISTENED_SECONDS = 60;

/** How far the skip controls move: ten seconds either way on a Catchup, 15 back and 30 on in a show. */
export function skipSeconds(id: string | null): { back: number; forward: number } {
  return id !== null && isShowEpisodeId(id)
    ? { back: 15, forward: 30 }
    : { back: SKIP_BACK_SECONDS, forward: SKIP_FORWARD_SECONDS };
}

/** What the device remembers of one episode, as the one reader gives it (player/core/resume.ts). */
export interface Heard {
  seconds: number;
  played: boolean;
}

export type HeardOf = (id: string) => Heard;

/** What the device keeps about a favorite show beside the route's answer. */
export interface Following {
  /** ISO time the show was favorited. */
  favorite_at: string;
  /** The newest full episode at that moment: the one back-catalog episode that counts as new. */
  newest_id: string | null;
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

/**
 * New means published after the show was favorited, plus the newest one at that moment. The back
 * catalog is unplayed, never new: a show with a thousand episodes arrives with a count of one.
 * A trailer or a bonus is never new, and neither is one already played or dismissed.
 */
export function isNewEpisode(
  episode: Pick<EpisodeRow, "id" | "kind" | "published_at">,
  following: Following | null,
  heard: Heard,
  dismissed = false,
): boolean {
  if (!following || episode.kind !== "full" || heard.played || dismissed) return false;
  if (episode.id === following.newest_id) return true;
  return time(episode.published_at) > time(following.favorite_at);
}

/** Oldest first, by publish time; an episode with no time keeps its place in the feed. */
function oldestFirst<T extends Pick<EpisodeRow, "published_at">>(episodes: readonly T[]): T[] {
  return episodes
    .map((episode, index) => ({ episode, index }))
    .sort(
      (a, b) =>
        time(a.episode.published_at) - time(b.episode.published_at) ||
        // The routes answer newest first: the later row is the older one.
        b.index - a.index,
    )
    .map(({ episode }) => episode);
}

export type PlayPick<T> = { episode: T; reason: "resume" | "new" | "first" | "latest" } | null;

/**
 * What a show's one Play starts: the episode left half heard (`lastId` when it is one, else the
 * newest of them); else the oldest new episode; else, in a show told in order, the first unplayed
 * one; else the newest. It never picks a trailer or a bonus, and never one already finished unless
 * nothing else is left.
 */
export function pickPlay<T extends Pick<EpisodeRow, "id" | "kind" | "published_at">>(
  show: Pick<ShowDetail, "order">,
  episodes: readonly T[],
  following: Following | null,
  heardOf: HeardOf,
  lastId: string | null = null,
): PlayPick<T> {
  const full = oldestFirst(episodes.filter((episode) => episode.kind === "full"));
  const halfHeard = full.filter((episode) => {
    const heard = heardOf(episode.id);
    return heard.seconds > 0 && !heard.played;
  });
  const resume = halfHeard.find((episode) => episode.id === lastId) ?? halfHeard.at(-1);
  if (resume) return { episode: resume, reason: "resume" };
  const fresh = full.find((episode) => isNewEpisode(episode, following, heardOf(episode.id)));
  if (fresh) return { episode: fresh, reason: "new" };
  if (show.order === "serial") {
    const first = full.find((episode) => !heardOf(episode.id).played);
    if (first) return { episode: first, reason: "first" };
  }
  const latest = full.at(-1) ?? oldestFirst(episodes).at(-1);
  return latest ? { episode: latest, reason: "latest" } : null;
}

/**
 * What follows a show episode when Up next is empty: the same show's next newer full episode that
 * is not played. Going newer suits a serial and does nothing odd on a news show, where the listener
 * is usually on the newest already. Null when there is none: playback stops.
 */
export function nextInShow<T extends Pick<EpisodeRow, "id" | "kind" | "published_at">>(
  episodes: readonly T[],
  currentId: string,
  heardOf: HeardOf,
): T | null {
  const ordered = oldestFirst(episodes);
  const at = ordered.findIndex((episode) => episode.id === currentId);
  if (at < 0) return null;
  return (
    ordered
      .slice(at + 1)
      .find((episode) => episode.kind === "full" && !heardOf(episode.id).played) ?? null
  );
}

/** How many of a show's episodes are new: the number on its dial tile and its Library cover. */
export function newCount(
  episodes: readonly Pick<EpisodeRow, "id" | "kind" | "published_at">[],
  following: Following | null,
  heardOf: HeardOf,
  dismissed: ReadonlySet<string> = new Set(),
): number {
  return episodes.filter((episode) =>
    isNewEpisode(episode, following, heardOf(episode.id), dismissed.has(episode.id)),
  ).length;
}
