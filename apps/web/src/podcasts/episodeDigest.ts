import type { EpisodeRow } from "../server/podcasts/shapes";
import type { PlayerDigestData } from "../types/contracts";

/** The colour a show episode's cover lights the player with until its own is read: the neutral key. */
const NEUTRAL_KEY = "var(--color-surface-sunken)";

/** Our cover route's address at one of its widths; the route answers 512 when none is asked. */
export function coverAt(cover: string, width: 128 | 256 | 512): string {
  return `${cover}&w=${width}`;
}

/**
 * A show episode as the player plays it: the same shape a Catchup's page gives it, so the bar, the
 * queue, resume, the lock screen and the swipe between items work by id with nothing new to learn.
 * It has no stories, so the player draws its lean page. The title is the show's name (the bar's
 * title is the podcast's name, D343) and the line under it is the episode's.
 */
export function episodeDigest(episode: EpisodeRow): PlayerDigestData | null {
  // An insecure address is tried over https by the route; one that still is not secure never plays.
  if (!episode.audio_url.startsWith("https://")) return null;
  const cover = episode.cover;
  return {
    id: episode.id,
    date: (episode.published_at ?? "").slice(0, 10),
    title: episode.show_title,
    kind: "regular",
    show: {
      id: episode.show_id,
      title: episode.show_title,
      episode_title: episode.title,
      chapters: episode.chapters,
      transcript: episode.transcript,
    },
    audio: { url: episode.audio_url, duration_ms: (episode.duration_s ?? 0) * 1000 },
    timeline: null,
    items: [],
    sections: [],
    cover: {
      src512: cover ? coverAt(cover, 512) : "",
      // The route's largest width is 512: the open player's cover is drawn from it.
      src1024: cover ? coverAt(cover, 512) : "",
      key: NEUTRAL_KEY,
    },
    prev_id: null,
    next_id: null,
  };
}
