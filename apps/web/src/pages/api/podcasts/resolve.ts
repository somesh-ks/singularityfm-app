import { toResponse } from "../../../server/http";
import { onlyGet, podcastRoute } from "../../../server/podcasts/live";
import {
  canonicalResolve,
  RESOLVE_PER_MINUTE,
  resolveLink,
} from "../../../server/podcasts/resolve";

export const prerender = false;

/** GET /api/podcasts/resolve?link=: the show a pasted link names, or the closest by its page's name. */
export const GET = podcastRoute("resolve", {
  canonical: canonicalResolve,
  // Up to eight index calls and one page read each: an OPML import of unknown feeds asks a few at a
  // time, so this cap holds a burst without letting one client spend the index's budget.
  perMinute: RESOLVE_PER_MINUTE,
  handle: async (params, deps) => toResponse(await resolveLink(params, { ...deps, fetch })),
});

export const ALL = onlyGet;
