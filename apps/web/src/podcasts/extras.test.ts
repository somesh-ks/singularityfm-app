import { describe, expect, it } from "vitest";
import { chapterRows, episodeBreaks, transcriptTurns } from "./extras";

describe("chapters with sponsor breaks", () => {
  // A break inside a chapter that never named the chapter again left the list's "now" on the break
  // for the rest of the chapter, and Next skipped what was left of it.
  it("names the chapter again after a break found inside it", () => {
    const chapters = [
      { start_s: 0, title: "Opening", url: null },
      { start_s: 100, title: "The main story", url: null },
      { start_s: 900, title: "Credits", url: null },
    ];
    const rows = chapterRows(chapters, [{ start_s: 400, end_s: 460 }], 1000);
    expect(rows.map((row) => [row.start_s, row.title, row.sponsor])).toEqual([
      [0, "Opening", false],
      [100, "The main story", false],
      [400, "Sponsor break", true],
      [460, "The main story", false],
      [900, "Credits", false],
    ]);
  });

  // The Changelog titles its ads "Sponsor: Deepgram": those are breaks too, run to the next chapter.
  // A chapter about ads ("Ad hoc teams", "Sponsorship deals") is talk, and skipping it lost it.
  it("takes a publisher's sponsor chapters as breaks, and not chapters about ads", () => {
    const chapters = [
      { start_s: 0, title: "Welcome", url: null },
      { start_s: 65, title: "Sponsor: ClickHouse", url: null },
      { start_s: 283, title: "Zach is back!", url: null },
      { start_s: 900, title: "Ad hoc teams", url: null },
      { start_s: 1200, title: "Sponsorship deals that work", url: null },
      { start_s: 1500, title: "Ads in podcasts", url: null },
      { start_s: 1800, title: "Wrap up", url: null },
    ];
    expect(episodeBreaks({ chapters, segments: [] }, 6000)).toEqual([{ start_s: 65, end_s: 283 }]);
  });

  // With no length in the feed a closing "Ad break" ran to Infinity: Skip sponsor read "Infinity"
  // and its press could not seek.
  it("takes no break from a last sponsor chapter whose end is unknown", () => {
    const chapters = [
      { start_s: 0, title: "Welcome", url: null },
      { start_s: 900, title: "Ad break", url: null },
    ];
    expect(episodeBreaks({ chapters, segments: [] }, Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe("a publisher's transcript as turns", () => {
  // A transcript of 1,500 short lines drew 1,500 rows and 18,000 words in the player; one speaker's
  // lines are one turn, and a new voice starts a new one.
  it("gathers one speaker's lines into a turn and starts another at a new voice", () => {
    const turns = transcriptTurns([
      { start_s: 0, end_s: 2, text: "Welcome back.", speaker: "Lenny" },
      { start_s: 2, end_s: 4, text: "Today a guest.", speaker: "Lenny" },
      { start_s: 4, end_s: 6, text: "Thanks for having me.", speaker: "Sherif" },
    ]);
    expect(turns.map((turn) => [turn.text, turn.speaker, turn.name])).toEqual([
      ["Welcome back. Today a guest.", "a", "Lenny"],
      ["Thanks for having me.", "b", "Sherif"],
    ]);
  });
});
