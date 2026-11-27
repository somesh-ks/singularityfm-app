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
function playingShow() {
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
        breaks: [{ start_s: 50, end_s: 80 }],
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
  // A seek of a fraction of a second across a break's start (1:49.8 to 1:50.2 on the scrubber) was
  // taken for playing into it, and the player jumped away from where the listener put it.
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
  });
});
