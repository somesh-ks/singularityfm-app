import type { Page } from "@playwright/test";
import type { PlayerDigestData } from "../src/types/contracts";
import { toRgba } from "./colors";
import { expect, hydrated, SILENT_DIGEST, seedStorage, test } from "./fixtures";

const FIRST_HEADLINE =
  "Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity";

test.describe("the podcast header", () => {
  test("renders the date, the play chip with the story count, and the More menu", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
    // The fixture recording is 36 seconds long, which a chip rounds up to a minute. The length is
    // the chip's label alone; under the date stands how many stories there are.
    await expect(page.locator(".hero-text .hero-facts > span")).toHaveText(["12 stories"]);
    const chip = page.locator(".hero [data-play-digest]");
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute("data-play-digest", "2026-10-07");
    await expect(chip).toHaveAccessibleName("Play the podcast, 1 min");
    await expect(chip).toHaveAttribute("data-state", "idle");
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
    await expect(page.locator(".hero-hint")).toHaveCount(0);
  });

  test("a podcast without audio keeps a working chip and says nothing about it", async ({
    page,
  }) => {
    await page.goto(SILENT_DIGEST);
    const chip = page.locator(".hero [data-play-digest]");
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute("data-state", "idle");
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    // The estimate written with the text stands in until there is a recording to measure.
    await expect(chip).toHaveAccessibleName("Play the podcast, 3 min");
    // Nothing is said under the chip: pressing it is self-explanatory.
    await expect(page.locator(".hero-hint")).toHaveCount(0);
    // The player leaves a briefing without audio exactly as the page rendered it.
    await hydrated(page);
    await expect(chip).toHaveAttribute("data-state", "idle");
  });

  test("asks for the intro and the first story at idle, and a press joins that work", async ({
    page,
  }) => {
    const asked: string[] = [];
    await page.context().route("**/api/narrate?digest=*", async (route) => {
      const ids: string[] = await page.evaluate(() => {
        const data = JSON.parse(
          document.getElementById("singularity-digest-data")?.textContent ?? "{}",
        );
        return (data.items as { id: string }[]).map((item) => item.id);
      });
      await route.fulfill({
        json: {
          status: 200,
          audio: null,
          timeline: null,
          ms_per_character: 62,
          segments: ["intro", ...ids].map((key) => ({
            key,
            item_id: key === "intro" ? null : key,
            characters: 300,
            audio: null,
          })),
        },
      });
    });
    await page.context().route("**/api/narrate", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const { segment } = route.request().postDataJSON() as { segment: string };
      asked.push(segment);
      // Slow enough that the press below lands while the first request is still on its way.
      await new Promise((resolve) => setTimeout(resolve, 600));
      return route.fulfill({
        json: {
          status: 200,
          segment: {
            key: segment,
            item_id: segment === "intro" ? null : segment,
            characters: 300,
            audio: { url: "/fixtures/audio.wav", duration_ms: 18_600, confirmed: true },
          },
        },
      });
    });
    await page.goto(SILENT_DIGEST);
    await hydrated(page);
    await expect.poll(() => asked.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect.poll(() => asked.length).toBeGreaterThanOrEqual(2);
    // The intro and the first story were each asked for once, by the prewarm, not again by the press.
    expect(asked.slice(0, 2)[0]).toBe("intro");
    expect(asked.filter((key) => key === "intro")).toHaveLength(1);
    expect(new Set(asked).size).toBe(asked.length);
  });

  test("pressing play on a podcast without audio narrates it story by story", async ({ page }) => {
    await page.goto(SILENT_DIGEST);
    await hydrated(page);
    const ids = await page.evaluate(() => {
      const data = JSON.parse(
        document.getElementById("singularity-digest-data")?.textContent ?? "{}",
      );
      return (data.items as { id: string }[]).map((item) => item.id);
    });
    // The server knows where each story's file would be. Here every one already exists.
    await page.context().route("**/api/narrate?digest=*", (route) =>
      route.fulfill({
        json: {
          status: 200,
          audio: null,
          timeline: null,
          ms_per_character: 62,
          segments: ["intro", ...ids].map((key) => ({
            key,
            item_id: key === "intro" ? null : key,
            characters: 300,
            audio: { url: "/fixtures/audio.wav", duration_ms: 18_600, confirmed: false },
          })),
        },
      }),
    );
    // Asked about the first one, the server answers that it exists.
    await page.context().route("**/api/narrate", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const { segment } = route.request().postDataJSON() as { segment: string };
      return route.fulfill({
        json: {
          status: 200,
          segment: {
            key: segment,
            item_id: segment === "intro" ? null : segment,
            characters: 300,
            audio: { url: "/fixtures/audio.wav", duration_ms: 18_600, confirmed: true },
          },
        },
      });
    });
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    const chip = page.locator(".hero [data-play-digest]");
    await expect(chip).toHaveAttribute("data-state", "current");
    await expect(chip).toHaveAccessibleName(/min left$/);
    // The story chips the page rendered hidden now have something to play.
    await expect(page.locator("[data-play-item]").first()).toBeVisible();
    await expect(page.locator(".hero-hint")).toBeHidden();
  });
});

test.describe("sharing", () => {
  test("Share opens a dialog with the dated address, Copy link copies it and says so, Close closes it", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const copied: string[] = [];
      (window as unknown as { __copied: string[] }).__copied = copied;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            copied.push(text);
            return Promise.resolve();
          },
        },
      });
    });
    await page.goto(SILENT_DIGEST);
    // An older briefing has the same Share as the latest (D104); it shares its own address, tagged so
    // the visit it brings counts as a share's (D154).
    await hydrated(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Share link" });
    await expect(dialog.getByLabel("Link")).toHaveValue(/\/d\/2026-10-05\?ref=share$/);
    await dialog.getByRole("button", { name: "Copy link" }).click();
    await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied),
    ).toEqual([expect.stringMatching(/\/d\/2026-10-05\?ref=share$/)]);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });

  // Only on-demand briefings and episodes can be deleted (#152): a Daily or Weekly has no Delete.
  test("every podcast offers Regenerate, which asks what to improve, and a daily no Delete", async ({
    page,
  }) => {
    for (const path of ["/", "/d/2026-10-07"]) {
      await page.goto(path);
      await hydrated(page);
      await page.getByRole("button", { name: "More actions" }).click();
      const items = page.locator("#hero-menu [role=menuitem]");
      await expect(items.filter({ hasText: "Regenerate" })).toHaveCount(1);
      await expect(items.filter({ hasText: "Delete" })).toHaveCount(0);
    }
    await openNewBriefing(page);
  });
});

async function openNewBriefing(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("menuitem", { name: "Regenerate" }).click();
  const dialog = page.getByRole("dialog", { name: "Regenerate" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox")).toBeVisible();
}

test.describe("sections and stories", () => {
  test("groups stories into sections in the fixed order", async ({ page }) => {
    await page.goto("/");
    const sections = page.locator("[data-chapter]");
    await expect(sections).toHaveCount(6);
    await expect(sections.locator("h2.section-head")).toHaveText([
      "Top picks",
      "Design engineering",
      "AI products",
      "Research",
      "Launches",
      "Watch and listen",
    ]);
    await expect(page.locator(".story")).toHaveCount(12);
    // A section header is its title alone: no listening time beside it.
    await expect(page.locator(".head-fact")).toHaveCount(0);
    await expect(sections.first().locator("h2.section-head")).toHaveText("Top picks");
  });

  test("keeps headings in order: the date, then sections, then stories", async ({ page }) => {
    await page.goto("/");
    const levels = await page
      .locator("main :is(h1, h2, h3)")
      .evaluateAll((nodes) => nodes.map((node) => Number(node.tagName.slice(1))));
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (let index = 1; index < levels.length; index += 1) {
      // A heading never skips a level on the way down.
      expect((levels[index] ?? 0) - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
    }
    await expect(page.locator(".story h3")).toHaveCount(12);
  });

  test("gives every story the attributes the player reads", async ({ page }) => {
    await page.goto("/");
    const stories = page.locator(".story");
    for (let index = 0; index < 12; index += 1) {
      const story = stories.nth(index);
      await expect(story).toHaveAttribute("data-index", String(index));
      await expect(story).toHaveAttribute("data-item-id", /^[0-9a-f]{12}$/);
      await expect(story.locator("[data-play-item]")).toHaveAttribute(
        "data-play-item",
        String(index),
      );
    }
    await expect(page.locator("[data-chapter]").first()).toHaveAttribute("data-chapter", "top");
    await expect(page.locator(".story[data-state]")).toHaveCount(0);
  });

  test("a story's time shows where it starts and names its action", async ({ page }) => {
    await page.goto("/");
    const chip = page.locator(".story").nth(1).locator("[data-play-item]");
    await expect(chip).toBeVisible();
    // The name starts with the figures it shows (WCAG 2.5.3), then says what a press does.
    await expect(chip).toHaveText("0:03");
    await expect(chip).toHaveAccessibleName(/^0:03, Play from here, 0:03: /);
    await expect(chip).toHaveAttribute("data-state", "idle");
    expect(await chip.evaluate((node) => node.tagName)).toBe("BUTTON");
  });

  test("hydration leaves every idle chip as the page rendered it", async ({
    page,
    browser,
    baseURL,
  }) => {
    const read = (target: typeof page) =>
      target.locator(".chip, [data-play-item]").evaluateAll((nodes) =>
        nodes.map((node) => ({
          label: node.querySelector("[data-chip-label]")?.textContent ?? node.textContent,
          name: node.getAttribute("aria-label"),
          state: node.getAttribute("data-state"),
          playing: node.getAttribute("data-playing"),
        })),
      );
    // The page as the server wrote it: the same build, with script turned off.
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const plain = await context.newPage();
    await plain.goto("/");
    const rendered = await read(plain);
    await context.close();
    // The briefing's chip and one time per story.
    expect(rendered).toHaveLength(13);

    await page.goto("/");
    await hydrated(page);
    // One frame for the player's first write.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    expect(await read(page)).toEqual(rendered);
  });

  test("the headline opens the summary, and the story's one link leads to its source in a new tab", async ({
    page,
  }) => {
    await page.goto("/");
    const first = page.locator(".story").first();
    // The story is named by the headline's words alone.
    await expect(first).toHaveAccessibleName(FIRST_HEADLINE);
    // Closed, a story is a line to scan: no summary, and no link to tab through.
    await expect(first.locator(".story-summary")).toBeHidden();
    await expect(first.getByRole("link")).toHaveCount(0);
    await first.locator("summary").click();
    await expect(first.locator(".story-summary")).toBeVisible();
    // One link a keyboard or a screen reader meets: the way to the source. Its name starts with
    // what it shows (WCAG 2.5.3); the new tab is said, not shown.
    const link = first.getByRole("link");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAccessibleName("Read the source at Springlet Blog (opens in a new tab)");
    await expect(link).toHaveAttribute("href", /^https:\/\/example\.com\//);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("a podcast narrated on Play has its Play unavailable offline, and back when online", async ({
    page,
    context,
  }) => {
    await page.goto(SILENT_DIGEST);
    // The page's idle request for its narration is made before the network goes away.
    await page.waitForLoadState("networkidle");
    await hydrated(page);
    const chip = page.locator(".hero [data-play-digest]");
    const before = await chip.getAttribute("data-state");
    expect(before).not.toBe("unavailable");
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(chip).toHaveAttribute("aria-disabled", "true");
    await expect(chip).toHaveAttribute("data-state", "unavailable");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    await expect(chip).toHaveAttribute("data-state", before ?? "");
  });

  test("Today's podcast chip says the time left or the length, and Played is the subtitle's mark", async ({
    page,
  }) => {
    await seedStorage(page, { local: { "singularity:resume:2026-10-07": "20" } });
    await page.goto("/");
    await hydrated(page);
    const chip = page.locator(".hero [data-play-digest]");
    await expect(chip).toHaveAccessibleName("Resume the podcast, 1 min left");
    // Heard to the end on another visit: the position is forgotten and the briefing is Played. Set
    // away from the page, which saves its own position as it is left.
    await page.goto("/library");
    await page.evaluate(() => {
      localStorage.removeItem("singularity:resume:2026-10-07");
      localStorage.setItem("singularity:played:2026-10-07", "1");
    });
    await page.goto("/");
    await hydrated(page);
    await expect(page.locator(".hero-facts .hero-played")).toBeVisible();
    await expect(chip).not.toHaveAccessibleName(/played|left/i);
    await expect(chip).toHaveAttribute("data-state", "idle");
  });

  test("the page does not pull a reader who scrolled elsewhere back to the voice", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await hydrated(page);
    await page.locator(".hero [data-play-digest]").click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    // A scroll that is not a wheel or a touch, far from the story being read.
    await page.evaluate(() => {
      document.querySelector("#c-watch")?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    const away = await page.evaluate(() => scrollY);
    expect(away).toBeGreaterThan(1000);
    // Playing goes on through three stories (three seconds each in the fixture).
    await page.waitForTimeout(8_000);
    expect(Math.abs((await page.evaluate(() => scrollY)) - away)).toBeLessThan(40);
  });

  test("keeps story chips in the page, hidden, while a podcast has no audio", async ({ page }) => {
    await page.goto(SILENT_DIGEST);
    await expect(page.locator(".story")).toHaveCount(8);
    const chips = page.locator("[data-play-item]");
    await expect(chips).toHaveCount(8);
    for (const chip of await chips.all()) {
      await expect(chip).toHaveAttribute("hidden", "");
      await expect(chip).toBeHidden();
    }
    // Sections show no listening length, and the text is complete without audio.
    await expect(page.locator(".head-fact")).toHaveCount(0);
    await hydrated(page);
    await expect(chips.first()).toHaveAttribute("hidden", "");
  });

  test("sets the digest id on the page and in the JSON the player reads", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toHaveAttribute("data-digest-id", "2026-10-07");
    await expect(page.locator("html")).toHaveAttribute("data-digest-id", "2026-10-07");
    const data = (await page.evaluate(() =>
      JSON.parse(document.getElementById("singularity-digest-data")?.textContent ?? "null"),
    )) as PlayerDigestData;
    expect(data.id).toBe("2026-10-07");
    expect(data.title).toBe("Wednesday 7 October");
    expect(data.items).toHaveLength(12);
    expect(data.items[0]?.start_ms).toBe(0);
    expect(data.audio).toEqual({ url: "/fixtures/audio.wav", duration_ms: 36_000 });
    expect(data.timeline).toBe("marks");
    expect(data.sections.map((section) => section.slug)).toEqual([
      "top",
      "ui-craft",
      "ai",
      "research",
      "launches",
      "watch",
    ]);
    expect(data.cover.src512).toMatch(/^\/covers\/2026-10-07-512\.webp\?v=\w+$/);
    // Pages show the WebP; the PNG beside it is for the lock screen's media controls.
    const webp = await page.request.get(data.cover.src512);
    expect(webp.headers()["content-type"]).toBe("image/webp");
    const png = await page.request.get("/covers/2026-10-07-512.png");
    expect(png.headers()["content-type"]).toBe("image/png");
    expect(data.cover.key).toMatch(/^#[0-9a-f]{6}$/);
    expect(data.prev_id).toBe("2026-10-05");
    expect(data.next_id).toBeNull();
    // The item ids in the data match the ids in the markup, in the same order.
    const ids = await page
      .locator(".story")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-item-id")));
    expect(data.items.map((item) => item.id)).toEqual(ids);
  });

  test("is readable with JavaScript turned off", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
    await expect(page.locator(".story")).toHaveCount(12);
    // A story opens without script: its summary and the way to its source.
    const first = page.locator(".story").first();
    await first.locator("summary").click();
    await expect(first.locator(".story-summary")).toBeVisible();
    await expect(first.locator(".source-link")).toBeVisible();
    await expect(page.locator("#c-research")).toHaveText("Research");
    await context.close();
  });
});

test.describe("the name strip over the stories", () => {
  // The app bar slides away on a scroll down unless motion is reduced, which moves the strip up with
  // it. These tests measure the strip against a bar that stays put.
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("an episode page says episode, not podcast, to assistive tech", async ({ page }) => {
    await page.goto("/e/ep-20261007-1930");
    await expect(page.locator(".skip-link")).toHaveText("Skip to the episode");
    await expect(page.locator(".hero [data-play-digest]")).toHaveAccessibleName(
      /^Play the episode, /,
    );
  });

  test("a control reached by Shift+Tab is never left under the strip (WCAG 2.4.11)", async ({
    page,
  }) => {
    await page.goto("/");
    // Far down the briefing, then back up one control at a time: each one scrolls clear of the
    // strip while it sticks.
    for (let step = 0; step < 26; step += 1) await page.keyboard.press("Tab");
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Shift+Tab");
      const covered = await page.evaluate(() => {
        const control = document.activeElement?.getBoundingClientRect();
        const strip = document.querySelector<HTMLElement>("[data-page-strip]");
        if (!control || !strip) return 0;
        const box = strip.getBoundingClientRect();
        const stuck = box.top <= Number.parseFloat(getComputedStyle(strip).top) + 0.5;
        return stuck ? Math.max(0, box.bottom - control.top) : 0;
      });
      expect(covered).toBe(0);
    }
  });

  test("shows the podcast's name once the stories reach the top, and a press goes back to the top", async ({
    page,
  }) => {
    await page.goto("/");
    await hydrated(page);
    const strip = page.locator("[data-page-top]");
    // At the top the header names the podcast: the strip is not there to see or to tab to.
    await expect(strip).toBeHidden();
    await page.evaluate(() => {
      document.querySelector("#c-research")?.scrollIntoView({ block: "start" });
    });
    await expect(strip).toBeVisible();
    await expect(strip).toContainText("Wednesday 7 October");
    await strip.click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await expect(strip).toBeHidden();
  });
});

test.describe("a headline under the pointer", () => {
  test("is underlined whole, a hyphenated word included", { tag: "@desktop" }, async ({ page }) => {
    // A Catchup's headline is still the link to its source; a podcast's story opens its summary.
    await page.goto("/e/ep-20261007-1930");
    await hydrated(page);
    const link = page.locator(".story-link", { has: page.locator(".no-break") }).first();
    await link.hover();
    const lines = await link.evaluate((node) =>
      [...node.querySelectorAll(".no-break")].map((word) => {
        const css = getComputedStyle(word);
        return css.textDecorationLine;
      }),
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toBe("underline");
  });
});

test.describe("earlier podcasts", () => {
  test("lists the earlier podcasts and a way to all of them", async ({ page }) => {
    await page.goto("/");
    // A shelf of covers, not a list: the same card the Library uses.
    await expect(
      page.getByRole("heading", { level: 2, name: "Earlier podcasts", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".earlier .shelf > .card")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/library");
    await expect(page.locator(".earlier .card-title")).toHaveText([
      "Monday 5 October",
      "Sunday 4 October",
    ]);
  });

  test("marks the weekly deep dive in the list of earlier podcasts", async ({ page }) => {
    await page.goto(SILENT_DIGEST);
    const weekly = page.locator(".earlier .card", { hasText: "Weekly" });
    await expect(weekly).toHaveCount(1);
    await expect(weekly.locator(".card-title")).toHaveText("Sunday 4 October");
    await expect(weekly.locator(".card-facts")).toHaveText("Weekly · 14 stories");
    await expect(page.locator(".earlier .cover[data-weekly]")).toHaveCount(1);
  });

  test("is left out under the oldest podcast, which has nothing before it", async ({ page }) => {
    await page.goto("/d/2026-10-04-weekly");
    await expect(page.locator(".story")).toHaveCount(14);
    await expect(page.locator(".earlier")).toHaveCount(0);
  });
});

test.describe("the page head", () => {
  test("carries the tags an installed iPhone app needs", async ({ page }) => {
    await page.goto("/");
    const head = page.locator("head");
    await expect(head.locator('meta[name="viewport"]')).toHaveAttribute(
      "content",
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
    await expect(head.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/apple-touch-icon.png",
    );
  });

  test("uses an opaque background on the sticky app bar", async ({ page }) => {
    await page.goto("/");
    const bar = await page.locator(".app-bar").evaluate((node) => {
      const style = getComputedStyle(node);
      return { position: style.position, background: style.backgroundColor, top: style.top };
    });
    expect(bar.position).toBe("sticky");
    expect(bar.top).toBe("0px");
    // Opaque means an alpha of one, which Safari 26 needs to sample the status-bar tint.
    expect((await toRgba(page, bar.background)).alpha).toBe(255);
    expect(bar.background).not.toContain("/");
  });
});

test.describe("the page's chrome", () => {
  test("the latest podcast at its dated address is the home page: no Back in the app bar", async ({
    page,
  }) => {
    await page.goto("/d/2026-10-07");
    // Opened from nowhere it shows no Back; the button is in the page, hidden, for a visit that came
    // from the Library (navSpeed.spec.ts).
    await expect(page.locator(".app-bar-back")).toBeHidden();
    await expect(page.locator('.app-nav [aria-current="page"]')).toHaveAttribute("href", "/");
    // An older briefing is one level down from the Library, and leads back to it.
    await page.goto(SILENT_DIGEST);
    await expect(page.locator(".app-bar-back")).toHaveAttribute("href", "/library");
  });
});

test.describe("the app bar's Back", () => {
  // The app bar shows below 64rem; the desktop project narrows its window to reach it with a mouse.
  async function narrow(page: Page): Promise<void> {
    const size = page.viewportSize();
    if (size && size.width >= 1024) await page.setViewportSize({ width: 900, height: size.height });
  }

  test("Back returns to the page you came from: Today, then an earlier podcast", async ({
    page,
  }) => {
    await narrow(page);
    await page.goto("/");
    await hydrated(page);
    await page.locator(`a[href="${SILENT_DIGEST}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${SILENT_DIGEST}$`));
    await page.locator(".app-bar-back").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Wednesday 7 October");
  });

  test("Back keeps the Library's filter, as system Back does", async ({ page }) => {
    await narrow(page);
    await page.goto("/library");
    await hydrated(page);
    // A phone has no sort since D127; the filter is the state a phone leaves the Library in.
    await page.locator(".filter-chip", { hasText: "Catch up" }).click();
    await expect(page).toHaveURL(/show=custom/);
    await page.locator('a.card-link[href^="/e/"]').first().click();
    await expect(page).toHaveURL(/\/e\//);
    await page.locator(".app-bar-back").click();
    await expect(page).toHaveURL(/\/library\?show=custom$/);
    await expect(
      page.locator(".filter-chip", { hasText: "Catch up" }).locator("input"),
    ).toBeChecked();
  });
});
