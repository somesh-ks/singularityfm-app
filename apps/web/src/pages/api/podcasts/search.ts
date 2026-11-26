import { toResponse } from "../../../server/http";
import { onlyGet, podcastRoute } from "../../../server/podcasts/live";
import { canonicalSearch, searchShows } from "../../../server/podcasts/routes";

export const prerender = false;

/** GET /api/podcasts/search?q=: shows matching the words, from Podcast Index, else Apple. */
export const GET = podcastRoute("search", {
  canonical: canonicalSearch,
  handle: async (params, deps) => toResponse(await searchShows(params.get("q") ?? "", deps)),
});

export const ALL = onlyGet;
