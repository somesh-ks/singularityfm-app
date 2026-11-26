import type { EpisodeRow, ShowDetail } from "../server/podcasts/shapes";
import {
  episodesOfShow,
  getShow,
  type StoredEpisode,
  type StoredShow,
  saveShow,
} from "./deviceStore";

/** One show and its episodes, newest first, as the show route answers. */
export interface ShowAnswer {
  show: ShowDetail;
  episodes: EpisodeRow[];
}

/** Why a show could not be read: it does not exist, or the network or the route failed. */
export type ShowFailure = "not_found" | "failed";

/** The most episodes the long page asks for (server/podcasts/routes.ts, SHOW_PAGE_SIZES). */
const ALL_EPISODES = 1000;

/**
 * Asks the show route and keeps its answer on the device, so the next visit, a queue row and a
 * reload draw from it before the network answers. `all` asks for the long list.
 */
export function fetchShow(id: number, all = false): Promise<ShowAnswer | ShowFailure> {
  return askShow(`id=${id}${all ? `&max=${ALL_EPISODES}` : ""}`);
}

/**
 * Finds a show by its feed address or its Apple Podcasts id (an import, a pasted link) and keeps
 * it on the device, as fetchShow does. The index answers for the feeds it knows.
 */
export function findShow(
  by: { url: string } | { apple: number },
): Promise<ShowAnswer | ShowFailure> {
  const query = new URLSearchParams(
    "url" in by ? { url: by.url } : { apple: String(by.apple) },
  ).toString();
  return askShow(query);
}

async function askShow(query: string): Promise<ShowAnswer | ShowFailure> {
  try {
    const response = await fetch(`/api/podcasts/show?${query}`, { credentials: "same-origin" });
    if (response.status === 404) return "not_found";
    if (!response.ok) return "failed";
    const body = (await response.json()) as Partial<ShowAnswer>;
    if (!body.show || !Array.isArray(body.episodes)) return "failed";
    const answer = { show: body.show, episodes: body.episodes };
    await saveShow(answer.show, answer.episodes);
    return answer;
  } catch {
    return "failed";
  }
}

/** What the device holds of a show: null when it has never been opened here. */
export async function storedShow(
  id: number,
): Promise<{ show: StoredShow; episodes: StoredEpisode[] } | null> {
  const show = await getShow(id);
  return show ? { show, episodes: await episodesOfShow(id) } : null;
}
