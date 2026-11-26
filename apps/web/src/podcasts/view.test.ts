import { describe, expect, it } from "vitest";
import { dayLabel, matchesSearch, noteParagraphs, timeFact } from "./view";

describe("an episode's facts", () => {
  // "0 min" under an episode whose feed gives no length, and a full length on a half heard one.
  it("says what is left of a half heard episode and nothing for an unknown length", () => {
    expect(timeFact(3600, { seconds: 0, played: false })).toBe("1 hr");
    expect(timeFact(3600, { seconds: 2700, played: false })).toBe("15 min left");
    expect(timeFact(3600, { seconds: 0, played: true })).toBe("1 hr");
    expect(timeFact(null, { seconds: 30, played: false })).toBe("");
  });

  // An episode from last year dated "24 Nov" reads as last week's.
  it("names the year once it is not this one", () => {
    const now = new Date(2026, 10, 26, 9);
    expect(dayLabel(new Date(2026, 10, 26, 1).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 25, 23).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 20).toISOString(), now)).toBe("20 Nov");
    expect(dayLabel(new Date(2025, 10, 20).toISOString(), now)).toBe("20 Nov 2025");
    expect(dayLabel("not a date", now)).toBe("");
  });

  it("finds an episode by words in its title or notes, in any order", () => {
    const episode = { title: "The chip war", description: "With a guest from Taiwan." };
    expect(matchesSearch(episode, "taiwan CHIP")).toBe(true);
    expect(matchesSearch(episode, "chip tariffs")).toBe(false);
  });
});

describe("show notes", () => {
  // A publisher's notes are untrusted: a script address made into a link would run on a tap.
  it("links only web addresses and keeps everything else as words", () => {
    const [first, second] = noteParagraphs(
      "Read more (https://example.com/a?b=1). Then javascript:alert(1) and <b>bold</b>.\n\nMail us.",
    );
    expect(first?.filter((part) => part.href).map((part) => part.href)).toEqual([
      "https://example.com/a?b=1",
    ]);
    expect(first?.map((part) => part.text).join("")).toContain(
      "javascript:alert(1) and <b>bold</b>",
    );
    expect(second).toEqual([{ text: "Mail us." }]);
  });
});
