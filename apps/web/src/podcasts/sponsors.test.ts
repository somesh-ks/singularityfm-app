import { describe, expect, it } from "vitest";
import { findSponsorBreaks, type TimedLine, transcriptFitsAudio } from "./sponsors";

/** Lines from real publisher transcripts (Lenny's Podcast, Latent Space), cut short. */
const line = (start_s: number, end_s: number, text: string): TimedLine => ({
  start_s,
  end_s,
  text,
});

const LENNY = [
  line(367.6, 370.2, "coming down from the mountain and handing over these instructions."),
  line(370.2, 375.0, "This episode is brought to you by this season's presenting sponsor, WorkOS."),
  line(375.0, 379.1, "What do OpenAI, Anthropic, Cursor, Replit, Sierra, Clay,"),
  line(381.7, 383.9, "They're all powered by WorkOS."),
  line(426.6, 430.8, "Go to workos.com to make your app enterprise ready today."),
  line(430.8, 433.5, "I'd love to hear more examples of what this looks like in practice"),
  line(433.5, 437.7, "of either what not to do, to do this badly,"),
];

describe("sponsor breaks", () => {
  // A skip that lands late plays the ad's tail; one that lands early cuts the guest. The break must
  // end where the sponsor's address is said, before the host turns back to the conversation.
  it("marks an ad read from its first line to the sponsor's address, and not the show after it", () => {
    const [found, ...rest] = findSponsorBreaks(LENNY);
    expect(rest).toEqual([]);
    expect(found?.start_s).toBe(370.2);
    expect(found?.end_s).toBeLessThanOrEqual(430.8);
    expect(found?.end_s).toBeGreaterThan(426.6);
  });

  // Latent Space, 27 Nov 2026: a host who says the episode "is brought to you by Deepgram" in the
  // intro, then talks for minutes; the first rules took an unrelated address 100 s later as the
  // ad's end and would have skipped the guests' introductions.
  it("marks nothing when the only address nearby is not the sponsor's", () => {
    const lines = [
      line(
        210,
        219,
        "The second one today is brought to you by Deepgram, and you'll hear more from us at the midpoint.",
      ),
      line(
        219,
        236,
        "You should be showing a robot an action one time, and then it should be able to do this.",
      ),
      line(296, 306, "And at the time you were about to launch BFL, after Stability."),
      line(306, 314, "So I'm Andi, and our site is bfl.ai if you want to try it."),
    ];
    expect(findSponsorBreaks(lines)).toEqual([]);
  });

  // Lenny's Podcast: "...get dx dot com slash Leny I want to kind of go" ends the ad and starts the
  // next question in one line; skipping to the next line would cut the question's first words.
  it("ends inside a line that runs on past the address", () => {
    const lines = [
      line(2748, 2752, "Okay. Season's supporting sponsor is DX."),
      line(2752, 2790, "With DX, you can measure the impact of AI adoption across your product."),
      line(2795, 2800, "of DX that's get dx dot com slash Leny I want to kind of go"),
      line(2800, 2805, "in a slightly different direction when talking about activation"),
    ];
    const [found] = findSponsorBreaks(lines);
    expect(found?.end_s).toBeLessThan(2800);
    expect(found?.end_s).toBeGreaterThan(2795);
  });
});

describe("whether the transcript fits the file", () => {
  // A host that inserts ads for each listener serves a longer file than the transcript was written
  // against: every time after the insert is late, and a skip would cut the show (Nov 12 plan).
  it("offers no skip when the file is longer than the feed says", () => {
    expect(transcriptFitsAudio({ audioS: 4898, feedS: 4898, transcriptEndS: 4896 })).toBe(true);
    expect(transcriptFitsAudio({ audioS: 4958, feedS: 4898, transcriptEndS: 4896 })).toBe(false);
  });

  it("offers no skip when the feed says no length and the file runs long past the transcript", () => {
    expect(transcriptFitsAudio({ audioS: 2350, feedS: null, transcriptEndS: 2340 })).toBe(true);
    expect(transcriptFitsAudio({ audioS: 2400, feedS: null, transcriptEndS: 2340 })).toBe(false);
  });

  it("offers no skip before the file's length is known", () => {
    expect(transcriptFitsAudio({ audioS: 0, feedS: 4898, transcriptEndS: 4896 })).toBe(false);
  });
});
