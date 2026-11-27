import { toResponse } from "../../../server/http";
import { onlyGet, podcastRoute } from "../../../server/podcasts/live";
import { canonicalResolve, resolveLink } from "../../../server/podcasts/resolve";

export const prerender = false;

/** GET /api/podcasts/resolve?link=: the show a pasted link names, or the closest by its page's name. */
export const GET = podcastRoute("resolve", {
  canonical: canonicalResolve,
  handle: async (params, deps) => toResponse(await resolveLink(params, { ...deps, fetch })),
});

export const ALL = onlyGet;
