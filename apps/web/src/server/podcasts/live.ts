import type { APIRoute } from "astro";
import { recordingFaults, toResponse } from "../http";
import { sharedLimit } from "../rateLimit";
import { createAppleSearch } from "./apple";
import { createIndexClient, indexKeys, newBreaker } from "./podcastIndex";
import { type Canonical, failure, type PodcastDeps } from "./routes";
import { createSigner } from "./signing";

/**
 * The podcast routes as the site runs them: the keys from the environment, one breaker per
 * instance, the shared per-minute limiter, and the request steps every route shares (canonical
 * address, per-client cap). Without the two Podcast Index settings every route answers 503.
 */

/** Function runs per client a minute, across all podcast routes; edge hits do not count. */
export const PER_CLIENT_PER_MINUTE = 120;

const breaker = newBreaker();

export function liveDeps(): PodcastDeps | null {
  const keys = indexKeys(process.env);
  if (!keys) return null;
  return {
    index: createIndexClient({ keys, fetch, breaker }),
    apple: createAppleSearch(fetch),
    sign: createSigner(keys.secret),
    limit: sharedLimit,
  };
}

const notConfigured = () =>
  toResponse(failure(503, "not_configured", "Podcasts are not set up on this server."));

const clientOf = (request: Request): string =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

export interface PodcastRouteOptions {
  canonical?: (params: URLSearchParams, now: number) => Canonical;
  /** How long the edge keeps the 308 to the canonical address. */
  redirectSeconds?: number;
  handle: (params: URLSearchParams, deps: PodcastDeps) => Promise<Response>;
  /** A route that costs several upstream calls a request keeps its own, smaller cap as well. */
  perMinute?: number;
}

/**
 * One podcast route: the canonical address first (a 308 to it when the query differs), then the keys,
 * then the client's cap, then the handler. Upstream 502s and 503s are the index's, not the site's,
 * so only a 500 is kept as a fault.
 */
export function podcastRoute(name: string, options: PodcastRouteOptions): APIRoute {
  const get: APIRoute = async ({ url, request }) => {
    let params = url.searchParams;
    if (options.canonical) {
      const canonical = options.canonical(url.searchParams, Date.now());
      if ("error" in canonical) return toResponse(canonical.error);
      // Compared as parsed, so a proxy that re-encodes a comma never loops the redirect.
      if (canonical.query !== new URLSearchParams(url.search).toString()) {
        const seconds = options.redirectSeconds ?? 86_400;
        return new Response(null, {
          status: 308,
          headers: {
            Location: `${url.pathname}?${canonical.query}`,
            "Cache-Control": `public, max-age=${Math.min(seconds, 300)}`,
            "Vercel-CDN-Cache-Control": `max-age=${seconds}`,
          },
        });
      }
      params = new URLSearchParams(canonical.query);
    }
    const deps = liveDeps();
    if (!deps) return notConfigured();
    const client = clientOf(request);
    const within =
      (await deps.limit(`podcasts:${client}`, PER_CLIENT_PER_MINUTE)) &&
      (options.perMinute === undefined ||
        (await deps.limit(`podcasts:${name}:${client}`, options.perMinute)));
    if (!within) {
      return toResponse({
        ...failure(429, "rate_limited", "Too many requests. Try again in a minute."),
      });
    }
    return options.handle(params, deps);
  };
  return recordingFaults(`api/podcasts/${name}`, get, { ours: (status) => status === 500 });
}

export const onlyGet: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
