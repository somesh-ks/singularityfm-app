import { toResponse } from "../../../server/http";
import { onlyGet, podcastRoute } from "../../../server/podcasts/live";
import { canonicalShow, showWithEpisodes } from "../../../server/podcasts/routes";

export const prerender = false;

/** GET /api/podcasts/show?id= | apple= | url= [&max=1000]: one show and its newest episodes. */
export const GET = podcastRoute("show", {
  canonical: canonicalShow,
  handle: async (params, deps) => toResponse(await showWithEpisodes(params, deps)),
});

export const ALL = onlyGet;
