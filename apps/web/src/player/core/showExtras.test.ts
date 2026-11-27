import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreferencesStore } from "./preferences";
import { startShowExtras } from "./showExtras";
import { createHarness, MemoryStorage, makeDigest } from "./testing";

vi.mock("@singularityfm/design-system/toastEvent", () => ({ sendToast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A show episode whose extras are in, with a break from 0:50 to 1:20 on a file that fits them. */
function playingShow(span = { start_s: 50, end_s: 80 }) {
  const harness = createHarness();
  const preferences = createPreferencesStore({
    storage: new MemoryStorage(),
    defaultSounds: () => false,
  });
  preferences.set({ sponsors: "skip" });
  startShowExtras(harness.store, preferences);
  harness.store.load(
    makeDigest({
      show: {
        id: 1,
        title: "A show",
        episode_title: "An episode",
        breaks: [span],
        transcript_end_s: 118,
      },
    }),
  );
  harness.audio.loadMetadata(120);
  harness.store.play();
  harness.audio.startPlaying();
  return harness;
}

describe("skipping sponsor breaks by themselves", () => {
  // A seek of a fraction of a second across a break's start (0:49.8 to 0:50.2 on the scrubber), or to
  // its very start, was taken for playing into it, and the player jumped away from where the
  // listener put it.
  it("skips a break the episode plays into, and never one a seek lands in", () => {
    const played = playingShow();
    played.audio.currentTime = 49.4;
    played.flushFrames();
    played.audio.currentTime = 50.1;
    played.flushFrames();
    expect(played.store.getTime()).toBe(80);

    const sought = playingShow();
    sought.audio.currentTime = 49.8;
    sought.flushFrames();
    sought.store.seekTo(50_200);
    expect(sought.store.getTime()).toBeCloseTo(50.2);

    // A seek to the break's very start (its row in the chapter list), then a second of it playing.
    const started = playingShow();
    started.store.seekTo(50_000);
    started.audio.currentTime = 51;
    started.flushFrames();
    expect(started.store.getTime()).toBe(51);

    // The same, with a pause between the seek and the playing.
    const paused = playingShow();
    paused.store.seekTo(50_000);
    paused.store.pause();
    paused.store.play();
    paused.audio.startPlaying();
    paused.audio.currentTime = 51;
    paused.flushFrames();
    expect(paused.store.getTime()).toBe(51);

    // A break at 0:00 is reached by pressing Play on the episode.
    const opening = playingShow({ start_s: 0, end_s: 30 });
    opening.audio.currentTime = 1;
    opening.flushFrames();
    expect(opening.store.getTime()).toBe(30);
  });
});
