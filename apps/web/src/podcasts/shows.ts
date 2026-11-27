import type { EpisodeRow, ShowDetail, ShowRow } from "../server/podcasts/shapes";
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

/** What /api/podcasts/resolve says a pasted link names (server/podcasts/resolve.ts). */
export interface LinkAnswer {
  show: ShowRow | null;
  matches: ShowRow[];
  name: string | null;
}

/**
 * Asks the server what show a pasted link names: any page or feed address, read there, since a
 * browser may not read another site. "not_found" when the page names no show at all.
 */
export async function resolveLink(link: string): Promise<LinkAnswer | ShowFailure> {
  try {
    const query = new URLSearchParams({ link }).toString();
    const response = await fetch(`/api/podcasts/resolve?${query}`, { credentials: "same-origin" });
    if (response.status === 404 || response.status === 400) return "not_found";
    if (!response.ok) return "failed";
    const body = (await response.json()) as Partial<LinkAnswer>;
    return {
      show: body.show ?? null,
      matches: Array.isArray(body.matches) ? body.matches : [],
      name: body.name ?? null,
    };
  } catch {
    return "failed";
  }
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
