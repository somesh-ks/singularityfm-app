import { toResponse } from "../../../server/http";
import { onlyGet, podcastRoute } from "../../../server/podcasts/live";
import { canonicalTrending, trendingShows } from "../../../server/podcasts/routes";

export const prerender = false;

/** GET /api/podcasts/trending?topic=&lang=: the index's trending shows, for one topic or all. */
export const GET = podcastRoute("trending", {
  canonical: canonicalTrending,
  handle: async (params, deps) => toResponse(await trendingShows(params, deps)),
});

export const ALL = onlyGet;
