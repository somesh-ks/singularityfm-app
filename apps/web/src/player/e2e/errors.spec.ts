import type { Page } from "@playwright/test";
import { expect, fulfillNarration, test } from "./helpers";

type Answer = { file: boolean } | { refusal: string; status?: number };

/**
 * A briefing whose segments are listed with no files. `answer` says how each segment is met: a made
 * file (which may itself be missing) or a refusal from the server.
 */
async function serve(page: Page, answer: (key: string) => Answer): Promise<void> {
  const ids = await page.evaluate(() => {
    const data = JSON.parse(
      document.getElementById("singularity-digest-data")?.textContent ?? "{}",
    );
    return (data.items as { id: string }[]).map((item) => item.id);
  });
  const keys = ["intro", ...ids];
  const segment = (key: string, confirmed: boolean) => ({
    key,
    item_id: key === "intro" ? null : key,
    characters: 300,
    audio: { url: `/narrated/${key}.mp3`, duration_ms: 18_600, confirmed },
  });
  await page.route("**/api/narrate?digest=*", (route) =>
    route.fulfill({
      json: {
        status: 200,
        audio: null,
        timeline: null,
        ms_per_character: 62,
        segments: keys.map((key) => segment(key, false)),
      },
    }),
  );
  await page.route("**/narrated/*.mp3", (route) => {
    const key = new URL(route.request().url()).pathname.split("/").pop()?.replace(".mp3", "") ?? "";
    const met = answer(key);
    return "file" in met && met.file
      ? fulfillNarration(route)
      : route.fulfill({ status: 404, body: "" });
  });
  await page.route("**/api/narrate", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { segment: key } = route.request().postDataJSON() as { segment: string };
    const met = answer(key);
    if ("refusal" in met) {
      return route.fulfill({ status: met.status ?? 429, json: { error: met.refusal } });
    }
    return route.fulfill({ json: { status: 200, segment: segment(key, true) } });
  });
}

test.describe("a recording that fails", () => {
  test("a recording with no audio shows the empty screen, and Try again plays it once the audio is back", async ({
    player,
    page,
    finger,
  }) => {
    await player.open("/d/2026-10-05");
    let missing = true;
    await serve(page, () => ({ file: !missing }));
    await finger.press(player.cta);
    // The file is asked for again a few times before the page gives up on it (the store may be back).
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 15_000 });
    await expect(page.locator(".dock-caption")).toHaveText("Audio isn't available");
    await player.openPlayer();
    // Controls that can only fail are not shown: the empty screen is, with a way to Downloads.
    await expect(
      player.dialog.getByRole("heading", { name: "Audio isn't available" }),
    ).toBeVisible();
    await expect(player.dialog.getByRole("link", { name: "Open Downloads" })).toBeVisible();
    await expect(player.dialog.locator(".transport")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("MEDIA_ELEMENT_ERROR");
    const live = await page.locator("[aria-live]").allTextContents();
    expect(live.join(" ")).not.toContain("MEDIA_ELEMENT_ERROR");
    missing = false;
    await finger.press(player.dialog.getByRole("button", { name: "Try again" }));
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    await expect(player.dialog.getByRole("heading", { name: "Audio isn't available" })).toHaveCount(
      0,
    );
  });

  test("when the server cannot list the narration, it says so and starts nothing", async ({
    player,
    page,
    finger,
  }) => {
    let asked = 0;
    await page.route("**/api/narrate?digest=*", (route) => {
      asked += 1;
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    });
    await player.open("/d/2026-10-05");
    await finger.press(player.cta);
    await expect.poll(() => asked).toBeGreaterThan(0);
    await expect(page.getByText("Narration hit a snag.")).toBeVisible();
    await expect(player.root).toHaveAttribute("data-player-state", "idle");
    await expect(player.cta).toHaveAttribute("data-state", "idle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a refusal that stands offers no Try again, and a story whose file is made still plays", async ({
    player,
    page,
  }) => {
    await player.open("/d/2026-10-05");
    const first = (await player.stories())[0]?.id;
    await serve(page, (key) =>
      key === "intro" || key === first ? { file: true } : { refusal: "daily_cap" },
    );
    await player.play();
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    await player.openPlayer();
    const next = player.dialog.locator(".transport [aria-label='Next story']");
    await next.click();
    await expect(player.root).toHaveAttribute("data-player-state", "playing");
    await next.click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    // Money: a standing cap is not offered as something to retry, in the strip or on the disc.
    const strip = page.locator('[data-banner="audio"]');
    await expect(strip).toContainText("Daily limit reached");
    await expect(strip.getByRole("button")).toHaveCount(0);
    await expect(player.dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.locator(".dock-caption")).toHaveText("Daily limit reached");
    // The chip under the page says what the disc and the bar say: Play, with the reason.
    await expect(player.cta).toHaveAttribute("data-state", "idle");
    await expect(player.cta).toHaveAttribute("aria-label", "Play the podcast, Daily limit reached");
    // A press on Play sends nothing, and the reason stays.
    await player.dialog.locator(".transport [data-primary]").click();
    await expect(strip).toContainText("Daily limit reached");
    // Back to story 1, whose file was made: it plays, and the reason goes.
    await player.dialog.locator(".transport [aria-label='Previous story']").click();
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    await expect(page.locator('[data-banner="audio"]')).toHaveCount(0);
  });

  test("a 503 mid-recording passes: Enter on the disc sends the request again once the server is back", async ({
    player,
    page,
  }) => {
    await player.open("/d/2026-10-05");
    let down = true;
    let asked = 0;
    await serve(page, (key) => {
      if (key === "intro") return { file: true };
      asked += 1;
      return down ? { refusal: "unavailable", status: 503 } : { file: true };
    });
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    const strip = page.locator('[data-banner="audio"]');
    await expect(strip).toContainText("Narration hit a snag");
    // Still down: Enter on the disc (named Try again) retries, and focus stays on it.
    const disc = player.dialog.locator(".transport [data-primary]");
    await disc.focus();
    await page.keyboard.press("Enter");
    await expect(disc).toBeFocused();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    await expect(disc).toBeFocused();
    down = false;
    const before = asked;
    await disc.click();
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    expect(asked).toBeGreaterThan(before);
  });

  test("a failure and its retry move nothing on the open page, and its strip is above the page", async ({
    player,
    page,
  }) => {
    const measure = () =>
      page.evaluate(() => {
        // From the cover: the strip squeezes the page as it does the app (the whole page moves a
        // little, and a centred group half as far), but the controls keep their distances.
        const at = (selector: string) =>
          document.querySelector(`[data-player-page] ${selector}`)?.getBoundingClientRect().top ??
          -1;
        const coverTop = at(".player-cover-frame");
        const top = (selector: string) => at(selector) - coverTop;
        const sheet = document.querySelector<HTMLElement>("[data-player-page]");
        return {
          overflow: sheet ? sheet.scrollHeight - sheet.clientHeight : -1,
          positions: [
            ".player-cover-frame",
            ".scrubber-track",
            ".transport",
            ".transport [data-primary]",
          ].map((selector) => Math.round(top(selector))),
        };
      });
    // A phone, a two-column tablet, and a short wide window.
    for (const size of ["390x844", "1024x768", "1280x600"]) {
      const [width = 0, height = 0] = size.split("x").map(Number);
      await page.setViewportSize({ width, height });
      await player.open("/d/2026-10-05");
      let failing = false;
      await serve(page, (key) =>
        failing && key !== "intro" ? { refusal: "synthesis_failed", status: 500 } : { file: true },
      );
      await player.play();
      await player.openPlayer();
      const rest = await measure();
      // One column scrolls its list by design; two columns fit the window.
      if (width >= 1024) expect(rest.overflow, `${size} at rest`).toBeLessThanOrEqual(1);
      failing = true;
      await player.dialog.locator(".transport [aria-label='Next story']").click();
      await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
      const failed = await measure();
      expect(failed.positions, `${size} in a failure`).toEqual(rest.positions);
      // The strip takes its own room off a short window, so the page may scroll a little in a failure.
      // The strip sits at the top of the window over the player, and the cover starts below it.
      const strip = await player.boxOf(page.locator('[data-banner="audio"]'));
      const cover = await player.boxOf(
        page.locator("[data-player-page] .player-cover-frame").first(),
      );
      expect(strip.y, `${size} strip at the top`).toBeLessThanOrEqual(1);
      expect(strip.y + strip.height, `${size} cover below the strip`).toBeLessThanOrEqual(
        cover.y + 1,
      );
      // A retry that fails again: during its load and after, nothing moves either.
      await player.dialog.locator(".transport [data-primary]").click();
      expect((await measure()).positions, `${size} retrying`).toEqual(rest.positions);
      await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
      expect((await measure()).positions, `${size} after the retry`).toEqual(rest.positions);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("a server's failure never starts by itself when the connection blips", async ({
    player,
    page,
    context,
  }) => {
    await player.open("/d/2026-10-05");
    let asked = 0;
    await serve(page, (key) => {
      if (key === "intro") return { file: true };
      asked += 1;
      return { refusal: "synthesis_failed", status: 500 };
    });
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    const before = asked;
    // A phone changing networks: offline, then back.
    await context.setOffline(true);
    await page.waitForTimeout(300);
    await context.setOffline(false);
    await page.waitForTimeout(1_500);
    expect(asked).toBe(before);
    await expect(player.root).toHaveAttribute("data-player-state", "error");
  });

  test("offline the strip is over the player and offers no Try again, and the connection's return plays on", async ({
    player,
    page,
    context,
  }) => {
    await player.open("/d/2026-10-05");
    // A routed request is answered even offline: the files stand in for the network themselves.
    let offline = false;
    await serve(page, () => ({ file: !offline }));
    await player.play();
    await player.openPlayer();
    offline = true;
    await context.setOffline(true);
    await player.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    const strip = page.locator('[data-banner="offline"]');
    await expect(strip).toHaveText("You are offline");
    await expect(strip).toBeInViewport();
    await expect(player.dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.locator(".dock-caption")).toHaveText("You are offline");
    offline = false;
    await context.setOffline(false);
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
  });
});
