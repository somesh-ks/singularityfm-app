import { expect, test } from "./fixtures";

const SHOW = {
  id: 7,
  apple_id: null,
  title: "The Test Hour",
  author: "Testers",
  feed_url: "https://podcast.test/feed",
  cover: null,
  categories: [],
  episode_count: 1,
  newest_at: "2026-11-20T08:00:00.000Z",
  source: "index",
};
const EPISODE = {
  id: "pe:7:0000000000000001",
  show_id: 7,
  show_title: "The Test Hour",
  guid: "guid-1",
  title: "First",
  published_at: "2026-11-20T08:00:00.000Z",
  duration_s: 36,
  audio_url: "https://podcast.test/1.wav",
  audio_insecure: false,
  audio_type: "audio/wav",
  audio_bytes: null,
  cover: null,
  description: "",
  link: null,
  season: null,
  episode: 1,
  kind: "full",
  transcript: null,
  chapters: null,
};

// A link handed over from Search must not follow a show by itself: any page could link here with a
// show in its address. The show is offered; a tap adds it, and the favorite outlives a reload.
test("a pasted link offers its show, follows it only when tapped, and the favorite lasts", async ({
  page,
}) => {
  await page.route("**/api/podcasts/resolve**", (route) =>
    route.fulfill({ json: { show: SHOW, matches: [], name: null } }),
  );
  await page.route("**/api/podcasts/show**", (route) =>
    route.fulfill({
      json: {
        show: {
          ...SHOW,
          description: "",
          link: null,
          language: "en",
          explicit: false,
          order: "episodic",
        },
        episodes: [EPISODE],
      },
    }),
  );
  const link = "https://open.spotify.com/show/2MAi0BvDc6GTFvKFPXnkCL";
  const visit = (href: string) =>
    page.evaluate((to) => {
      const anchor = Object.assign(document.createElement("a"), { href: to });
      document.body.append(anchor);
      anchor.click();
    }, href);
  // A second in-app visit, as Search hands a link over: the page's script runs once a session, and
  // once wired only the first visit (CodeRabbit, 27 Nov).
  await page.goto(`/add-show?link=${encodeURIComponent(link)}`);
  await visit("/search");
  await page.waitForURL(/\/search/);
  await visit(`/add-show?link=${encodeURIComponent(link)}`);
  const match = page.locator("[data-add-show-list] a", { hasText: "The Test Hour" });
  await expect(match).toBeVisible();
  // Nothing followed yet: the show's own page says it is not a favorite.
  await page.goto("/show?id=7");
  await expect(page.locator("[data-show-favorite]")).toHaveAttribute("aria-pressed", "false");

  await page.goto(`/add-show?link=${encodeURIComponent(link)}`);
  await match.click();
  await page.waitForURL(/\/show\?id=7/);
  await page.reload();
  await expect(page.locator("[data-show-favorite]")).toHaveAttribute("aria-pressed", "true");
});

// A new device must meet first run once, and only once: Skip ends it, and Home stays Home after
// (Nov 12 plan, slice 6). The fixtures mark every other test's device as past first run.
test("a new device opens first run once, and Skip ends it", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.route("**/api/podcasts/**", (route) => route.fulfill({ json: { shows: [] } }));
  await page.goto("/");
  await page.waitForURL(/\/welcome$/);
  await page.locator("button[data-first-run-skip]").click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.reload();
  await expect(page.locator("[data-home]")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
  await context.close();
});
