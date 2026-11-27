import type { APIRoute } from "astro";
import { recordingFaults, toResponse } from "../http";
import { sharedLimit } from "../rateLimit";
import { createAppleChart, createAppleSearch } from "./apple";
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

/** Time spent waiting on each upstream in one request, for the Server-Timing header. */
export type Spent = Record<"index" | "apple", number>;

/** `fn` timed into `spent[name]`; parallel calls add up, so the figure is work, not wall time. */
function timed<A extends unknown[], R>(
  spent: Spent | undefined,
  name: keyof Spent,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  if (!spent) return fn;
  return async (...args) => {
    const start = performance.now();
    try {
      return await fn(...args);
    } finally {
      spent[name] += performance.now() - start;
    }
  };
}

export function liveDeps(spent?: Spent): PodcastDeps | null {
  const keys = indexKeys(process.env);
  if (!keys) return null;
  return {
    index: timed(spent, "index", createIndexClient({ keys, fetch, breaker })),
    apple: timed(spent, "apple", createAppleSearch(fetch)),
    chart: timed(spent, "apple", createAppleChart(fetch)),
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
  /** False for a route that costs the site nothing worth capping (a signed cover or extras file). */
  limited?: boolean;
  handle: (params: URLSearchParams, deps: PodcastDeps) => Promise<Response>;
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
    const started = performance.now();
    const spent: Spent = { index: 0, apple: 0 };
    const deps = liveDeps(spent);
    if (!deps) return notConfigured();
    // A cover or extras file is signed by us and kept for good: it needs no database check per hit.
    if (
      options.limited !== false &&
      !(await deps.limit(`podcasts:${clientOf(request)}`, PER_CLIENT_PER_MINUTE))
    ) {
      return toResponse({
        ...failure(429, "rate_limited", "Too many requests. Try again in a minute."),
      });
    }
    const response = await options.handle(params, deps);
    // Where a slow answer went (index and Apple calls add up when made in parallel). Names only.
    const total = performance.now() - started;
    try {
      response.headers.set(
        "Server-Timing",
        `index;dur=${spent.index.toFixed(0)}, apple;dur=${spent.apple.toFixed(0)}, total;dur=${total.toFixed(0)}`,
      );
    } catch {
      // An immutable response goes without the header.
    }
    return response;
  };
  return recordingFaults(`api/podcasts/${name}`, get, { ours: (status) => status === 500 });
}

export const onlyGet: APIRoute = () =>
  toResponse({ status: 405, body: { error: "method_not_allowed" }, headers: { Allow: "GET" } });
