import { coverFile } from "../../../server/podcasts/files";
import { onlyGet, podcastRoute } from "../../../server/podcasts/live";
import { canonicalFile } from "../../../server/podcasts/routes";

export const prerender = false;

/** GET /api/podcasts/cover?u=&s=&w=: a publisher's cover we listed, resized to WebP, kept for good. */
export const GET = podcastRoute("cover", {
  canonical: canonicalFile(["u", "s", "w"]),
  limited: false,
  handle: (params, deps) => coverFile(params, { fetch, sign: deps.sign }),
});

export const ALL = onlyGet;
