import { extrasFile } from "../../../server/podcasts/files";
import { onlyGet, podcastRoute } from "../../../server/podcasts/live";

export const prerender = false;

/** GET /api/podcasts/extras?k=&u=&s=: an episode's transcript segments or chapters, kept for good. */
export const GET = podcastRoute("extras", {
  limited: false,
  handle: (params, deps) => extrasFile(params, { fetch, sign: deps.sign }),
});

export const ALL = onlyGet;
