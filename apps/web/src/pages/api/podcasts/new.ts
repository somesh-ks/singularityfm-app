import { toResponse } from "../../../server/http";
import { onlyGet, podcastRoute } from "../../../server/podcasts/live";
import { canonicalNew, EDGE_SECONDS, newEpisodes } from "../../../server/podcasts/routes";

export const prerender = false;

/** GET /api/podcasts/new?ids=1,2&since=: every new episode across up to 200 shows, in one index call. */
export const GET = podcastRoute("new", {
  canonical: canonicalNew,
  // The canonical `since` moves every quarter hour, so its redirect is kept no longer.
  redirectSeconds: EDGE_SECONDS.new,
  handle: async (params, deps) => toResponse(await newEpisodes(params, deps)),
});

export const ALL = onlyGet;
