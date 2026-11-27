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

  // A company the talk names after the opener closed a break over the talk at its address, and a
  // second mention of the sponsor's address in the guest's question ran the break over the question.
  it("keeps talk that names a company or the sponsor again out of the break", () => {
    expect(
      findSponsorBreaks([
        line(0, 4, "This episode is brought to you by Acme."),
        line(4, 30, "GitHub has changed how maintainers review code."),
        line(30, 40, "The new workflow is documented at github.com."),
      ]),
    ).toEqual([]);
    expect(
      findSponsorBreaks([
        line(0, 4, "Thanks to our sponsors."),
        line(4, 30, "GitHub has changed how maintainers review code."),
        line(30, 40, "The new workflow is documented at github.com."),
      ]),
    ).toEqual([]);
    // A sponsor named on the line after the opener is still the sponsor.
    expect(
      findSponsorBreaks([
        line(0, 2, "And now, my sponsor,"),
        line(2, 10, "Antithesis, which tests your distributed systems."),
        line(10, 20, "Learn more at antithesis.com."),
        line(20, 30, "So, back to it."),
      ]),
    ).toHaveLength(1);
    const [found] = findSponsorBreaks([
      line(0, 4, "This episode is brought to you by Acme, the build tool."),
      line(4, 20, "Acme runs every build on fast machines for your whole team."),
      line(20, 30, "Visit acme.com. Back to our guest: why did you leave acme.com?"),
      line(30, 40, "Well, it was time."),
    ]);
    expect(found?.end_s).toBeLessThan(26);
  });

  // A line that closes the talk and opens the ad started the break at the line's start, so Skip
  // sponsor jumped over the host's last sentence.
  it("starts a break at the sentence that opens it, not at its line", () => {
    const lines = [
      line(100, 110, "That is why it matters. Today's sponsor is Acme, the build tool for teams."),
      line(110, 130, "Acme runs your builds on fast machines and caches every step for you."),
      line(130, 140, "Try it free at acme dot com slash pod."),
      line(140, 150, "So back to the question of builds."),
    ];
    const [found] = findSponsorBreaks(lines);
    expect(found?.start_s).toBeGreaterThan(102);
    expect(found?.start_s).toBeLessThan(104);
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
