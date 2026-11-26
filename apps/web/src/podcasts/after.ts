import { isPlayed } from "../player/core/cardProgress";
import { readRemembered, type StorageLike } from "../player/core/resume";
import { type HeardOf, nextInShow, showIdOf } from "./rules";

/** What the device remembers of an episode, as the rules ask for it: the one reader's answer. */
export function heardOnDevice(storage: StorageLike | null): HeardOf {
  return (id) => {
    const remembered = readRemembered(storage, id);
    return { seconds: remembered.seconds, played: isPlayed(remembered) };
  };
}

/** How many of a show's episodes Up next lists after the one playing. */
const LISTED = 5;

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
