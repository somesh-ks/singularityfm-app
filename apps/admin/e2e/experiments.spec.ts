import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { handleExperiments } from "../src/lib/experimentsApi";
import { expect, test } from "./fixtures";
import { startServer } from "./staticServer.mjs";

/**
 * The Experiments page against a store that takes its time to write (a cold function, Neon waking).
 * The server here is a real one, not Playwright routes: a route fails a request still on its way
 * when the page reloads, which hides what a browser does with one that is really out (Chromium
 * rejects the page's promise at once and lets the request go on). The write waits on a gate the
 * test opens, so nothing here sleeps. Moved from the reader's slowStore.spec.ts (D382 step 4).
 */

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

interface SlowStore {
  baseURL: string;
  /** Writes that reached the server. */
  posts: () => number;
  /** The switches the store holds. */
  switches: Map<string, boolean>;
  /** Lets the writes that wait land. */
  land: () => void;
  close: () => void;
}

async function slowStore(): Promise<SlowStore> {
  let posts = 0;
  const switches = new Map<string, boolean>();
  let land: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    land = resolve;
  });
  // The page's function (api/experiments.ts), over a store whose writes wait on the gate.
  const experiments = async (request: IncomingMessage, response: ServerResponse) => {
    let bodyText = "";
    for await (const chunk of request) bodyText += chunk;
    if (request.method === "POST") posts += 1;
    const answer = await handleExperiments(
      {
        method: request.method ?? "GET",
        contentType: request.headers["content-type"] ?? null,
        bodyText,
      },
      {
        read: async () =>
          [...switches].map(([id, enabled]) => ({ id, enabled, promoted_at: null })),
        hits: async () => ({}),
        setEnabled: async (id, enabled) => {
          await gate;
          switches.set(id, enabled);
          return true;
        },
        setPromoted: async () => {},
      },
    );
    response.writeHead(answer.status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(answer.body));
  };
  const server = startServer({
    root: DIST,
    port: 0,
    api(request, response, pathname) {
      if (pathname !== "/admin/api/experiments") return false;
      void experiments(request, response);
      return true;
    },
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}`,
    posts: () => posts,
    switches,
    land,
    close: () => server.close(),
  };
}

/**
 * The test owns its browser context, so the suite's `problems` fixture does not watch its page: the
 * page errors and console errors (a reload's cut requests are not one) are gathered here.
 */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/Failed to load resource|net::ERR|Failed to fetch/.test(message.text())) return;
    problems.push(`console: ${message.text()}`);
  });
  return problems;
}

// 2026-10-30: a switch pressed and the page reloaded while the store was still taking the write
// showed the old state (D259). The page keeps its change in the tab until the store has it.
test("an experiment switched on while the store is slow stays on through two reloads", async ({
  browser,
}) => {
  const store = await slowStore();
  const context = await browser.newContext({
    baseURL: store.baseURL,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    const problems = watch(page);
    const trusted = page.getByRole("switch", { name: "Trusted publishers" });
    const settled = (): Promise<void> =>
      expect(page.locator("[data-experiments][data-ready]")).toBeVisible();
    await page.goto("/admin/experiments");
    await settled();
    await expect(trusted).not.toBeChecked();

    await trusted.click();
    await page.locator("[data-confirm-go]").click();
    await expect(trusted).toBeChecked();
    await expect.poll(() => store.posts()).toBe(1);
    await page.reload();
    await settled();
    await expect(trusted).toBeChecked();

    store.land();
    await expect.poll(() => store.switches.get("trusted-publishers")).toBe(true);
    await page.reload();
    await settled();
    await expect(trusted).toBeChecked();
    expect(problems).toEqual([]);
  } finally {
    await context.close();
    store.close();
  }
});
