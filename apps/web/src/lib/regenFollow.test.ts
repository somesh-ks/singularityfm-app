import { autoStories, mostStories } from "@singularityfm/core/storyCount";
import { describe, expect, it } from "vitest";
import {
  desiredChip,
  desiredLength,
  desiredStories,
  NO_ANSWER,
  stepLength,
  wantedControls,
  wordCount,
  wordLength,
  wordStories,
} from "./regenFollow";

describe("regenFollow (D371)", () => {
  // The bug it prevents: a control that stays after the comment that called for it is cleared.
  it("calls for nothing once the words and the models' answers are gone", () => {
    const answer = {
      hints: { length: true, topics: false, stories: false },
      values: { length: "longer" as const, stories: "more" as const, add: ["AI"] },
    };
    expect(wantedControls("it dragged", ["AI"], answer)).toEqual({
      length: true,
      topics: true,
      stories: true,
    });
    expect(wantedControls("", ["AI"], NO_ANSWER)).toEqual({
      length: false,
      topics: false,
      stories: false,
    });
  });

  // The bug it prevents: "shorter" from the 3 minute episode landing on a length that is not offered.
  it("steps one length along and stops at the ends", () => {
    expect(stepLength(5, "longer")).toBe(10);
    expect(stepLength(5, "shorter")).toBe(3);
    expect(stepLength(3, "shorter")).toBe(3);
    expect(stepLength(15, "longer")).toBe(15);
    expect(desiredLength(5, NO_ANSWER.values)).toBe(5);
  });

  // The bug it prevents (2026-11-06): "More stories" reached the run at the count the length set
  // and aired 12 stories again. The count is its own control now (D377), stepped from what aired
  // before any model answers, and the length stays where it was.
  it("answers 'more stories' with more stories, not a longer length", () => {
    expect(wordStories("More stories")).toBe("more");
    expect(wordLength("More stories")).toBeNull();
    expect(desiredLength(5, NO_ANSWER.values, "More stories")).toBe(5);
    // At 5 minutes the step from 12 lands on Auto's count, which the list offers only as Auto.
    const stepped = desiredStories(12, 5, NO_ANSWER.values, "More stories");
    expect(Number(stepped || autoStories(5))).toBeGreaterThan(12);
    expect(wordStories("not enough news")).toBe("more");
    expect(wordStories("fewer stories please")).toBe("fewer");
    expect(wordStories("too many stories")).toBe("fewer");
    expect(wordStories("more stories but fewer stories")).toBeNull();
    // A topic or an aside is not a count.
    expect(wordStories("more stories about AI")).toBeNull();
    expect(wordStories("more stories in Sports")).toBeNull();
    expect(wordStories("fewer stories in crypto")).toBeNull();
    expect(wordStories("more stories in it")).toBe("more");
    expect(wordStories("no more stories, please")).toBeNull();
    // No ask for a count leaves it on Auto, which sends nothing.
    expect(desiredStories(12, 5, NO_ANSWER.values, "too much hype")).toBe("");
    // More than the length holds takes the next length too, so the ask is never sent unchanged:
    // 3 minutes holds 14 at the shortest telling, so 12 aired steps to 5 minutes and 15 stories.
    expect(desiredLength(3, NO_ANSWER.values, "More stories", 12)).toBe(5);
    expect(wantedControls("More stories", [], NO_ANSWER, 3, 12).length).toBe(true);
    // Haiku's answer beats the words once it comes.
    expect(desiredStories(12, 5, { length: null, stories: "fewer", add: [] }, "More stories")).toBe(
      "10",
    );
    expect(wantedControls("More stories", [], NO_ANSWER).stories).toBe(true);
  });

  // The bug it prevents (2026-11-09): "make it 20 stories" left Stories hidden on Auto, so the
  // episode aired the count the length set; "the first 3 stories were boring" must not set 3.
  it("sets the count the words name, and a length that holds it", () => {
    const at = (text: string, asked: number, aired = 12) => {
      const minutes = desiredLength(asked, NO_ANSWER.values, text, aired);
      return [minutes, desiredStories(aired, minutes, NO_ANSWER.values, text)];
    };
    expect(at("make it 20 stories", 5)).toEqual([5, "20"]);
    expect(at("twenty-five stories please", 3)).toEqual([5, "25"]);
    expect(at("35 stories", 5)).toEqual([10, "35"]);
    expect(at("a dozen items", 5)).toEqual([5, "12"]);
    expect(at("5 more stories", 5)).toEqual([5, "17"]);
    expect(at("drop 2 stories", 5)).toEqual([5, "10"]);
    // Held to what can air: never under the floor, never over what the longest length holds.
    expect(at("2 stories", 5)).toEqual([5, "3"]);
    expect(at("100 stories", 5)).toEqual([10, String(mostStories(10))]);
    // A count equal to Auto's is Auto.
    expect(at("15 stories", 5)).toEqual([5, ""]);
    expect(wantedControls("make it 20 stories", [], NO_ANSWER).stories).toBe(true);
    // A description of what aired, a topic, or two counts that disagree name none.
    for (const text of [
      "the first 3 stories were boring",
      "2 stories were repeated",
      "it had 12 stories",
      "3 stories about AI",
      "10 stories or 20 stories",
    ]) {
      expect(wordCount(text)).toBeNull();
      expect(wantedControls(text, [], NO_ANSWER).stories).toBe(false);
    }
    // An unknown aired count steps from Auto's, and a step is one a listener hears.
    expect(desiredStories(Number.NaN, 5, NO_ANSWER.values, "fewer stories")).toBe("10");
    expect(desiredStories(29, 10, NO_ANSWER.values, "more stories")).toBe("35");
  });

  it("steps the length on words about time", () => {
    expect(wordLength("it was too short")).toBe("longer");
    expect(wordLength("too long and it dragged")).toBe("shorter");
    expect(wordLength("the AI story is no longer news")).toBeNull();
    expect(wordLength("Shorter intro")).toBeNull();
    expect(wordLength("make it shorter")).toBe("shorter");
    // Haiku's answer beats the words once it comes.
    expect(desiredLength(5, { length: "shorter", stories: null, add: [] }, "too short")).toBe(3);
    // Whatever moves the length shows its control.
    expect(wantedControls("it dragged", [], NO_ANSWER).length).toBe(true);
  });

  it("keeps a category the episode was made with and adds the one the comment wants", () => {
    const values = { length: null, stories: null, add: ["Business"] };
    expect(desiredChip("Business", false, values)).toBe(true);
    expect(desiredChip("AI", true, values)).toBe(true);
    expect(desiredChip("AI", false, values)).toBe(false);
  });
});
