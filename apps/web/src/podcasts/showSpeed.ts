import { isPlaybackRate } from "../player/core/playerTypes";
import type { StorageLike } from "../player/core/resume";
import { showIdOf } from "./rules";

/**
 * The speed last used on each public show (owner, 2026-11-23: a dense show slower, a chatty one
 * faster). A small map in the key store, not the shows database, because the player asks for it in
 * the same turn it loads an episode. Persisted, so its keys are show ids and nothing else.
 */
export const SHOW_SPEED_KEY = "singularity:show-speed";

function readAll(storage: StorageLike | null): Record<string, number> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(SHOW_SPEED_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

/** The speed kept for the show this episode belongs to; null for a Catchup or a show with none. */
export function showSpeedFor(storage: StorageLike | null, episodeId: string): number | null {
  const showId = showIdOf(episodeId);
  if (showId === null) return null;
  const rate = readAll(storage)[String(showId)];
  return isPlaybackRate(rate) ? rate : null;
}

/** Keeps `rate` for the episode's show. A Catchup's id keeps nothing here. */
export function rememberShowSpeed(
  storage: StorageLike | null,
  episodeId: string,
  rate: number,
): void {
  const showId = showIdOf(episodeId);
  if (showId === null || !isPlaybackRate(rate)) return;
  try {
    storage?.setItem(SHOW_SPEED_KEY, JSON.stringify({ ...readAll(storage), [showId]: rate }));
  } catch {
    // Best effort: private modes and quotas throw.
  }
}
