import { isPlayed } from "../player/core/cardProgress";
import { readRemembered, type StorageLike } from "../player/core/resume";
import { type HeardOf, nextInShow, pickPlay, showIdOf } from "./rules";

/** What the device remembers of an episode, as the rules ask for it: the one reader's answer. */
export function heardOnDevice(storage: StorageLike | null): HeardOf {
  return (id) => {
    const remembered = readRemembered(storage, id);
    return { seconds: remembered.seconds, played: isPlayed(remembered) };
  };
}

/** How many of a show's episodes Up next lists after the one playing. */
const LISTED = 3;

/**
 * What follows a show episode when the listener queued nothing: the same show's next newer unplayed
 * full episodes, nearest first (rules.ts, nextInShow). Empty for a Catchup's id, for a show the
 * device holds no list of, and after the newest episode: playback stops there.
 */
export async function showEpisodesAfter(
  currentId: string,
  storage: StorageLike | null,
): Promise<string[]> {
  const showId = showIdOf(currentId);
  if (showId === null) return [];
  const { episodesOfShow } = await import("./deviceStore");
  const episodes = await episodesOfShow(showId);
  const heardOf = heardOnDevice(storage);
  const ids: string[] = [];
  for (let at = currentId; ids.length < LISTED; ) {
    const next = nextInShow(episodes, at, heardOf);
    if (!next) break;
    ids.push(next.id);
    at = next.id;
  }
  return ids;
}

/**
 * More to hear after a show episode, from the listener's other favorite shows (owner, 2026-11-26:
 * "suggest better and more, not just two from the same podcast"): each show's half heard episode
 * first, then each show's new or first unplayed one, one per show. Offered under the show's own
 * episodes and never started by Autoplay (playerRuntime.ts, playUpNext).
 */
export async function otherShowsAfter(
  currentId: string,
  storage: StorageLike | null,
): Promise<string[]> {
  const showId = showIdOf(currentId);
  const { episodesOfShow, favoriteShows, followingOf } = await import("./deviceStore");
  const heardOf = heardOnDevice(storage);
  const shows = (await favoriteShows()).filter((show) => show.id !== showId);
  const picks = await Promise.all(
    shows.map(async (show) =>
      pickPlay(
        show,
        await episodesOfShow(show.id),
        followingOf(show),
        heardOf,
        show.last_episode_id ?? null,
      ),
    ),
  );
  const unplayed = picks.filter((pick) => pick && !heardOf(pick.episode.id).played);
  return [
    ...unplayed.filter((pick) => pick?.reason === "resume"),
    ...unplayed.filter((pick) => pick?.reason !== "resume"),
  ].flatMap((pick) => (pick ? [pick.episode.id] : []));
}
