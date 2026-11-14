import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import { configCooldownSeconds, parseConfigRequest } from "../src/server/configEdit";
import { handleConfigRead } from "../src/server/configStore";
import type { ConfigOp } from "../src/types/contracts";

/**
 * /api/config answered with the site's own request parser and ten-second cooldown (server/
 * configEdit.ts), not by a stub that says 202 to everything. Only the store write is faked: each
 * edit is recorded, and the gap between edits (the 429) holds as it does in production. The clock
 * is the page's, so `page.clock` moves both.
 *
 * A stub that always answered 202 let "Stop hearing from" ship unable to send a second edit inside
 * the gap (docs/engineering/reliability-audit-2026-10-15.md).
 */
export interface ConfigServer {
  /** The edits that were saved, in order. */
  applied: ConfigOp[];
  /** The status of every answer, in order. */
  statuses: number[];
}

export async function routeConfigServer(page: Page): Promise<ConfigServer> {
  const server: ConfigServer = { applied: [], statuses: [] };
  let lastWrite: number | null = null;
  // One request at a time, so the gap is checked against the edit before it as it would be on a
  // single function instance; the order is the order the requests arrived in.
  let queue: Promise<void> = Promise.resolve();
  await page.route(/\/api\/config(\?|$)/, (route) => {
    queue = queue.then(() => answer(route)).catch(() => {});
    return queue;
  });
  async function answer(route: Route): Promise<void> {
    const now = await page.evaluate(() => Date.now());
    const request = parseConfigRequest(route.request().postData() ?? "");
    let status = 202;
    let headers: Record<string, string> | undefined;
    let json: unknown = { status: 202 };
    if (request === null) {
      status = 400;
      json = { status: 400, error: "invalid_request" };
    } else {
      const wait = configCooldownSeconds(lastWrite === null ? [] : [lastWrite], now);
      if (wait > 0) {
        status = 429;
        headers = { "Retry-After": String(wait) };
        json = { status: 429, error: "cooldown", retry_after_s: wait };
      } else {
        server.applied.push(...(Array.isArray(request.op) ? request.op : [request.op]));
        lastWrite = now;
      }
    }
    server.statuses.push(status);
    await route.fulfill({ status, ...(headers ? { headers } : {}), json });
  }
  return server;
}

const fixture = (name: string): string =>
  readFileSync(new URL(`../src/fixtures/config/${name}`, import.meta.url), "utf8");

/** The fixture config the test build is made from: what the function bundles in production. */
export const BUILT_FILES: Record<string, string> = {
  "config/topics.json": fixture("topics.json"),
  "config/sources.json": fixture("sources.json"),
  "config/sources.user.json": fixture("sources.user.json"),
};

/**
 * GET /api/config with the config store on (D149), answered by the site's own read handler
 * (server/configStore.ts) over a store that holds what `holds` returns (repository path to text),
 * or that is down when it returns null. Any other method goes on to the routes set before this one.
 */
export async function routeConfigStore(
  page: Page,
  holds: () => Record<string, string> | null,
): Promise<void> {
  await page.route(/\/api\/config(\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const stored = holds();
    const result = await handleConfigRead({
      env: {},
      storeUrl: "postgres://e2e.invalid/store",
      builtFiles: BUILT_FILES,
      connectConfigStore: async () => ({
        query: async () => {
          if (stored === null) throw new Error("connect ECONNREFUSED");
          return Object.entries(stored).map(([path, content]) => ({ path, content, version: 1 }));
        },
      }),
    });
    await route.fulfill({ status: result.status, headers: result.headers, json: result.body });
  });
}
