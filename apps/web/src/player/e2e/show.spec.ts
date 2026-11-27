import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";

/** An invented show as the show route answers it: three full episodes, newest first. */
const SHOW_ID = 7;
const episode = (n: number, day: number, title: string) => ({
  id: `pe:${SHOW_ID}:${n.toString(16).padStart(16, "0")}`,
  show_id: SHOW_ID,
  show_title: "The Test Hour",
  guid: `guid-${n}`,
  title,
  published_at: `2026-11-${String(day).padStart(2, "0")}T08:00:00.000Z`,
  duration_s: 36,
  audio_url: `https://podcast.test/${n}.wav`,
  audio_insecure: false,
  audio_type: "audio/wav",
  audio_bytes: null,
  cover: null,
  description: "Notes.",
  link: null,
  season: null,
  episode: n,
  kind: "full",
  transcript: null as string | null,
  chapters: null,
});
const ANSWER = {
  show: {
    id: SHOW_ID,
    apple_id: null,
    title: "The Test Hour",
    author: "Testers",
    feed_url: "https://podcast.test/feed",
    cover: null,
    categories: [],
    episode_count: 3,
    newest_at: "2026-11-20T08:00:00.000Z",
    source: "index",
    description: "A show for tests.",
    link: null,
    language: "en",
    explicit: false,
    order: "episodic",
  },
  episodes: [episode(3, 20, "Third"), episode(2, 10, "Second"), episode(1, 3, "First")],
};

async function serveShow(page: Page): Promise<void> {
  await page.route("**/api/podcasts/show**", (route) => route.fulfill({ json: ANSWER }));
  // The publisher's file is the fixture site's own recording, read from the site's address.
  await page.route("https://podcast.test/*.wav", async (route) => {
    const url = new URL("/fixtures/audio.wav", page.url()).toString();
    await route.fulfill({ response: await route.fetch({ url, headers: {} }) });
  });
}

// A show episode is not one of the site's own pages, so nothing but the device can bring it back:
// played from its show's page, it vanished from the bar on a reload, and when it ended the next
// older Catchup started in place of the show's own next episode (flow spec, 23 Nov 2026).
test("an episode played from its show's page is followed by the show's next one, and both outlive a reload", async ({
  player,
  page,
}) => {
  await serveShow(page);
  await player.open(`/show?id=${SHOW_ID}`);
  const row = (title: string) =>
    page
      .locator("[data-show-episodes] li")
      .filter({ hasText: title })
      .locator("[data-episode-play]");
  await player.finger.press(row("First"));
  await expect(player.root).toHaveAttribute("data-player-state", "playing");
  await expect(row("First")).toHaveAccessibleName("Pause First");

  // Into its last second: it ends, and the show's next newer episode starts by itself.
  await page.evaluate(() => {
    const element = window.__audios[0];
    if (element) element.currentTime = element.duration - 0.5;
  });
  await expect(row("Second")).toHaveAccessibleName("Pause Second");
  await expect(row("First")).toHaveAccessibleName("Play again First");

  await page.reload({ waitUntil: "networkidle" });
  // The bar holds the second episode again, read from the device with no page of ours behind it.
  await expect(player.sheet).toContainText("Second");
  await expect(row("First")).toHaveAccessibleName("Play again First");
});

/** A publisher's timed transcript with one ad read in it, from 4 s to the sponsor's address at 20 s. */
const TRANSCRIPT = {
  segments: [
    { start_s: 0, end_s: 4, text: "Welcome to the Test Hour.", speaker: "Host" },
    { start_s: 4, end_s: 10, text: "This episode is brought to you by Acme.", speaker: "Host" },
    { start_s: 10, end_s: 16, text: "Acme makes the anvils we test with.", speaker: "Host" },
    { start_s: 16, end_s: 20, text: "Go to acme.com.", speaker: "Host" },
    { start_s: 20, end_s: 35, text: "Back to the conversation.", speaker: "Host" },
  ],
};

// A skip lands on the line after the ad; and where the file this device got is longer than the feed
// says (a host that inserts ads for each listener), every time in the transcript is late, so a skip
// would cut the show: no button at all (Nov 12 plan, "Sponsor skip and chapters").
test("Skip sponsor jumps past an ad read, and never shows on a file longer than the feed says", async ({
  player,
  page,
}) => {
  const fits = { ...episode(1, 3, "First"), transcript: "/api/podcasts/extras?k=t&u=1" };
  // The fixture recording is 36 s; this feed says 30, as if 6 s of ads were inserted.
  const longer = {
    ...episode(2, 10, "Second"),
    duration_s: 30,
    transcript: "/api/podcasts/extras?k=t&u=2",
  };
  await serveShow(page);
  await page.route("**/api/podcasts/show**", (route) =>
    route.fulfill({ json: { ...ANSWER, episodes: [episode(3, 20, "Third"), longer, fits] } }),
  );
  await page.route("**/api/podcasts/extras**", (route) => route.fulfill({ json: TRANSCRIPT }));
  await player.open(`/show?id=${SHOW_ID}`);
  const row = (title: string) =>
    page
      .locator("[data-show-episodes] li")
      .filter({ hasText: title })
      .locator("[data-episode-play]");
  const skip = player.sheet.getByRole("button", { name: /^Skip sponsor/ });
  const seek = (seconds: number) =>
    page.evaluate((at) => {
      const element = window.__audios[0];
      if (element) element.currentTime = at;
    }, seconds);
  const time = () => page.evaluate(() => window.__audios[0]?.currentTime ?? 0);

  await player.finger.press(row("First"));
  await player.openPlayer();
  await expect(player.dialog.getByRole("tab", { name: "Transcript" })).toBeVisible();
  await seek(6);
  await player.finger.press(skip);
  await expect.poll(time).toBeGreaterThanOrEqual(19.5);
  await expect(skip).toHaveCount(0);

  await player.shut();
  await player.finger.press(row("Second"));
  await player.openPlayer();
  await expect(player.dialog.getByRole("tab", { name: "Transcript" })).toBeVisible();
  await seek(6);
  await expect.poll(time).toBeGreaterThan(7);
  await expect(skip).toHaveCount(0);
});
