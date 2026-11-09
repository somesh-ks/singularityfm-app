import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Locator, type Page } from "@playwright/test";

/**
 * Every test fails if its page logs an error, throws, or breaks the Content-Security-Policy. The
 * policy is delivered both as a header (vercel.json, applied by the test server) and as a meta
 * element, so a violation here is a violation in production.
 */
export interface Problems {
  messages: string[];
}

interface Options {
  /** Set for a test that goes offline on purpose, where failed requests are expected. */
  allowNetworkErrors: boolean;
}

export const test = base.extend<Options & { problems: Problems }>({
  allowNetworkErrors: [false, { option: true }],
  problems: [
    async ({ page, allowNetworkErrors }, use) => {
      const problems: Problems = { messages: [] };
      // A new episode's live copy (D105): the static site has no API, and nothing is written yet.
      await page.route("**/api/stream?**", (route) =>
        route.fulfill({ status: 200, json: { status: "waiting", turns: [] } }),
      );
      // The page's own reports (client errors and CSP violations) go to /api/report, which the
      // static site does not have; the API takes them with 204.
      await page.route("**/api/report", (route) => route.fulfill({ status: 204 }));
      // The podcast queue asks which runs are going while this browser has one on record: none, unless a
      // test says otherwise (a later route answers first).
      // The Sources pages ask for the current ratings; none changes a built row.
      await page.route("**/api/source-ratings", (route) =>
        route.fulfill({ json: { ratings: {} } }),
      );
      await page.route("**/api/generations", (route) =>
        route.fulfill({ status: 200, json: { generations: [] } }),
      );
      // The sources' own icons (https://<host>/favicon.ico) are on invented hosts; a one-pixel image
      // answers them, so the page is not blamed for a network that is not there.
      await page.route("**/api/site-icon**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
            "base64",
          ),
        }),
      );
      // A page the test asks for on purpose and that answers 404 logs one console line for itself.
      const expectedNotFound = new Set<string>();
      page.on("response", (response) => {
        if (response.status() === 404 && response.request().isNavigationRequest()) {
          expectedNotFound.add(response.url());
        }
      });
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (expectedNotFound.has(message.location().url)) return;
        // A page without audio asks for its narration shortly after it loads, and an open player
        // for the turn's word marks. The static fixture server has no API and answers 501, which the
        // browser logs on the page's behalf. The client takes it as a quiet refusal; this one line is
        // not a problem.
        if (
          /status of 501/.test(text) &&
          /\/api\/narrate(-marks)?(\?|$)/.test(message.location().url)
        )
          return;
        const isNetworkNoise =
          /Failed to load resource|net::ERR|Failed to fetch|Error hydrating/.test(text);
        if (allowNetworkErrors && isNetworkNoise) return;
        problems.messages.push(`console: ${text} ${message.location().url}`);
      });
      page.on("pageerror", (error) => problems.messages.push(`pageerror: ${error.message}`));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const holder = window as unknown as { __csp?: string[] };
          holder.__csp = holder.__csp ?? [];
          holder.__csp.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
        });
      });
      await use(problems);
      const violations = await page
        .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
        .catch(() => []);
      expect([...problems.messages, ...violations.map((v) => `csp: ${v}`)]).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The podcast queue's dock on a phone: shown while a run is going and for the day after one ended. */
export const queueDock = (page: Page): Locator => page.locator("[data-queue-dock]");

/** What the queue's newest row says under its name: the stage while it goes, when and how once it ended. */
export const queueStatus = (page: Page): Locator =>
  page.locator("[data-queue-dock] [data-queue-status]").first();

/** The dock's head once every run of the day is over and made: its ring has become a check. */
export const queueComplete = (page: Page): Locator =>
  page.locator('[data-queue-dock] [data-queue-fold-ring][data-ended="done"]');

/** Opens the dock if it is folded, and gives its Start listening link: a finished run stays in the queue with it. */
export async function startListening(page: Page): Promise<Locator> {
  const toggle = page.locator("[data-queue-toggle]");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  return page.locator("[data-queue-dock]").getByRole("link", { name: /^Start listening/ });
}

export const ROUTES = [
  { name: "home", path: "/" },
  { name: "latest digest", path: "/d/2026-10-07" },
  { name: "digest without audio", path: "/d/2026-10-05" },
  { name: "weekly digest", path: "/d/2026-10-04-weekly" },
  { name: "library", path: "/library" },
  { name: "offline page", path: "/offline" },
  { name: "not found", path: "/does-not-exist" },
] as const;

/** One page of each kind the app has, for sweeps that must hold on every page. */
export const SITE_PAGES = [
  "/",
  "/d/2026-10-07",
  "/e/ep-20261007-1930",
  "/library",
  "/create",
  "/settings",
  "/settings/daily",
  "/settings/weekly",
  "/settings/sound",
  "/settings/appearance",
  "/settings/haptics",
  "/profile",
  "/settings/preferences",
  "/settings/blocked-outlets",
  "/settings/categories",
  "/settings/categories/audio_interfaces",
  "/settings/categories/other",
];

/**
 * Seeds storage before the first page of the test loads, and only then: a page saves its own state
 * as it unloads, so storage written from a page and then reloaded can be overwritten by that page.
 * Values are written as given; `Date.now()` in a value is the test's own clock (page.clock).
 */
export async function seedStorage(
  page: Page,
  seed: { local?: Record<string, string>; session?: Record<string, string> },
): Promise<void> {
  await page.addInitScript((data) => {
    if (sessionStorage.getItem("e2e:seeded")) return;
    sessionStorage.setItem("e2e:seeded", "1");
    for (const [key, value] of Object.entries(data.local ?? {})) localStorage.setItem(key, value);
    for (const [key, value] of Object.entries(data.session ?? {}))
      sessionStorage.setItem(key, value);
  }, seed);
}

/** The fixture digest with an audio timeline. */
export const AUDIO_DIGEST = "/d/2026-10-07";

/** The fixture digest whose audio is still being prepared. */
export const SILENT_DIGEST = "/d/2026-10-05";

/**
 * Wakes the player and sheets islands, as the page's first input would once the browser is idle
 * (scripts/islandWake.ts), without the input's own side effects (the focus ring, a press).
 */
export async function wakeIslands(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as { dispatchAwake?: boolean };
    if (scope.dispatchAwake) return;
    scope.dispatchAwake = true;
    dispatchEvent(new Event("singularity:wake"));
  });
}

/**
 * Resolves once the player and sheets islands have woken and hydrated. They wait for a first input
 * or a start, so a test that reads the bar, a sheet or a toast wakes them first.
 */
export async function hydrated(page: Page): Promise<void> {
  await wakeIslands(page);
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
  await coversSettled(page);
}

/**
 * On a phone a Play opens the player over the page (2026-11-02, the owner's ask); a test that goes
 * on to use the page closes it. From 1024px only the bar changes, so there is nothing to close.
 */
export async function closePlayer(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 0) >= 1024) return;
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-player", "open");
  await page.getByRole("button", { name: "Close the player" }).click();
  await expect(html).toHaveAttribute("data-player", "closed");
}

/**
 * The woken player draws the page's covers and decodes the large one at idle. A test that goes
 * offline next would cut those loads short and fail on their console errors, so it waits for them.
 */
async function coversSettled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll<HTMLImageElement>("astro-island img")];
    // A lazy image off screen is never fetched, so it is not waited for.
    if (!images.every((image) => image.complete || image.loading === "lazy")) return false;
    const data = document.getElementById("singularity-digest-data")?.textContent;
    const large = data
      ? (JSON.parse(data) as { cover?: { src1024?: string } }).cover?.src1024
      : null;
    return (
      !large || performance.getEntriesByType("resource").some((entry) => entry.name.endsWith(large))
    );
  });
}

/**
 * How far a control answers a pointer around its centre, in CSS pixels. A chip is 36px tall and
 * extends its target to 44px with a pseudo-element, which a bounding box does not show; hit testing
 * does. Scrolls the control to the middle of the screen first, clear of the sticky bars.
 */
export async function targetSize(control: Locator): Promise<{ width: number; height: number }> {
  return control.evaluate((node) => {
    node.scrollIntoView({ block: "center", inline: "center" });
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hits = (dx: number, dy: number): boolean => {
      const found = document.elementFromPoint(x + dx, y + dy);
      return found !== null && (found === node || node.contains(found));
    };
    const reach = (dx: number, dy: number): number => {
      let distance = 0;
      while (distance < 60 && hits(dx * (distance + 1), dy * (distance + 1))) distance += 1;
      return distance;
    };
    return { width: reach(-1, 0) + reach(1, 0) + 1, height: reach(0, -1) + reach(0, 1) + 1 };
  });
}

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Axe's WCAG 2.2 AA violations on the page as it is now, one line each. */
export async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
}

/**
 * Scans the page as it stands in the light scheme, then in the dark one, so one set-up covers both.
 * Colours change over a transition, so each scan waits for the finite animations to end first.
 */
export async function expectNoViolationsInEitherScheme(page: Page): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const finite = document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getComputedTiming().endTime !== Infinity,
        );
      // A second at most: an animation that never ends is not waited for.
      await Promise.race([
        Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    });
    expect(await violations(page), `${scheme} scheme`).toEqual([]);
  }
}

/** A finger, which a phone's long press needs: Playwright has no hold, so the touch goes by the protocol. */
export async function holdFinger(page: Page, target: Locator): Promise<() => Promise<void>> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to hold: the target has no box");
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at] });
  return async () => {
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await client.detach();
  };
}

/** A finger's sideways swipe across the target, through Chromium's touch input, by dx CSS px. */
export async function swipeFinger(page: Page, target: Locator, dx: number): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to swipe: the target has no box");
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width / 2;
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: x0, y }],
  });
  for (let step = 1; step <= 10; step += 1) {
    await page.waitForTimeout(16);
    const point = { x: x0 + (dx * step) / 10, y };
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

/**
 * Opens a Library row's menu the way the device does (D264): a hold on a touch screen, where the
 * ⋮ is not pressable, and a press of the ⋮ with a mouse.
 */
export async function openRowMenu(page: Page, row: Locator): Promise<void> {
  const touch = await page.evaluate(
    () => matchMedia("(hover: none) and (pointer: coarse)").matches,
  );
  if (!touch) {
    await row.locator("[data-hero-more]").click();
    return;
  }
  const release = await holdFinger(page, row.locator(".card-title"));
  await expect(row.locator(".menu-list")).toBeVisible();
  await release();
}
