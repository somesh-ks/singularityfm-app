import { autoStories, FEWEST_STORIES, mostStories } from "@singularityfm/core/storyCount";
import { type Hints, hintsFor } from "./regenHints";
import { REGEN_LENGTHS } from "./regenLength";
import { stepStories } from "./storyOptions";

/**
 * What the Regenerate controls do as the comment changes (D371). The comment is the input, the
 * controls follow it both ways: a control appears when the words call for it and goes when they no
 * longer do, and the values a model proposes are set on controls the listener has not touched.
 * Client-safe, pure.
 */
export interface Values {
  length: "shorter" | "longer" | null;
  /** The story count, a step from what aired (D377). */
  stories: "more" | "fewer" | null;
  add: string[];
}

/** What the models said about the current words; empty until they answer. */
export interface Answer {
  hints: Hints;
  values: Values;
}

export const NO_ANSWER: Answer = {
  hints: { length: false, topics: false, stories: false },
  values: { length: null, stories: null, add: [] },
};

/** The controls the comment calls for: its words, Jev, or a value Haiku proposed. */
export function wantedControls(
  text: string,
  labels: readonly string[],
  answer: Answer,
  /** The length asked and the stories aired, when the sheet knows them: a full length shows Length. */
  asked = Number.NaN,
  aired = Number.NaN,
): Hints {
  const words = hintsFor(text, labels);
  // The words that move the length show its control, so a value it sends is never hidden.
  const length =
    words.length ||
    (Number.isFinite(asked) && desiredLength(asked, answer.values, text, aired) !== asked) ||
    wordLength(text) !== null ||
    answer.hints.length ||
    answer.values.length !== null;
  const stories =
    words.stories ||
    wordStories(text) !== null ||
    wordCount(text) !== null ||
    answer.values.stories !== null;
  // Length and Stories show together, as on Catch up and Settings: each moves the other (owner,
  // 2026-11-10), so one shown alone would change out of sight.
  const size = length || stories;
  return {
    length: size,
    topics: words.topics || answer.hints.topics || answer.values.add.length > 0,
    stories: size,
  };
}

/** One step along the lengths on offer, from the one asked; the end of the list stays put. */
export function stepLength(from: number, direction: "shorter" | "longer"): number {
  const at = REGEN_LENGTHS.indexOf(from as (typeof REGEN_LENGTHS)[number]);
  if (at < 0) return from;
  return (
    REGEN_LENGTHS[
      Math.max(0, Math.min(REGEN_LENGTHS.length - 1, at + (direction === "longer" ? 1 : -1)))
    ] ?? from
  );
}

// "More stories about AI" or "in Sports" asks for a topic, "no more stories" and "no longer news" for
// nothing, and "shorter intro" for one part: none of them moves the story count or the length. "More
// stories in it" moves the count (D377): the length no longer sets it.
const TOPIC = String.raw`(?!\s+(?:about|on|from|around|regarding|covering)\b|\s+in\s+(?!(?:it|this|each|the\s+(?:episode|podcast|briefing|show))\b))`;
const PART = String.raw`(?!\s+(?:intro|introduction|opening|outro|ending|sign-off|summaries|sentences|turns|bridges)\b)`;
const WANTS_LONGER = new RegExp(
  String.raw`\b(?:(?<!\b(?:no|any)\s)longer${PART}|too short|more (?:time|depth|detail))\b`,
  "i",
);
const WANTS_SHORTER = new RegExp(
  String.raw`\b(?:shorter${PART}|briefer${PART}|too long|dragged)\b`,
  "i",
);
const WANTS_MORE = new RegExp(
  String.raw`\b(?:(?<!\bno\s)(?:more|extra|additional)\s+(?:stories|story|items|news|coverage)${TOPIC}|not enough (?:stories|news|coverage)|too few (?:stories|items))\b`,
  "i",
);
const WANTS_FEWER = new RegExp(
  String.raw`\b(?:(?:fewer|less)\s+(?:stories|story|items|news)${TOPIC}|too many (?:stories|items))\b`,
  "i",
);

/** One of two directions the words alone ask for: null when they ask for both or neither. */
function wayOf<T>(text: string, up: RegExp, down: RegExp, ways: readonly [T, T]): T | null {
  const a = up.test(text);
  const b = down.test(text);
  return a === b ? null : a ? ways[0] : ways[1];
}

/**
 * What the words alone ask of the length. This answers at once and without a model, so the length
 * follows the comment even when Haiku is slow, rate-limited or wrong.
 */
export function wordLength(text: string): "shorter" | "longer" | null {
  return wayOf(text, WANTS_LONGER, WANTS_SHORTER, ["longer", "shorter"] as const);
}

/**
 * What the words alone ask of the story count (D377). It used to step the length, since the length
 * set the count; 2026-11-06 "More stories" was sent at the length it was made at and aired 12 again.
 */
export function wordStories(text: string): "more" | "fewer" | null {
  return wayOf(text, WANTS_MORE, WANTS_FEWER, ["more", "fewer"] as const);
}

// A count in the words: "20 stories", "twenty items", "a dozen stories", "stories: 20", or one
// relative to what aired, "5 more stories", "drop 2 stories". Not a description of what aired ("the
// first 3 stories were boring", "it had 12 stories") nor a topic ("3 stories about AI").
const UNITS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen";
const TENS = "twenty|thirty|forty|fifty";
const NUMBER = String.raw`(?:\d{1,3}|half a dozen|(?:a\s+)?dozen|(?:${TENS})(?:[\s-](?:one|two|three|four|five|six|seven|eight|nine))?|${UNITS})`;
const STORIES = String.raw`(?:news\s+)?(?:stories|items)`;
const DESCRIBED = String.raw`(?<!\b(?:first|last|top|those|these|the|other|same|of|from|had|has|got|aired|played|contained|included)\s+(?:only\s+|just\s+)?)`;
const NOT_PAST = String.raw`(?!\s+(?:were|was|had|felt|seemed|that|which|repeated|got|did|aired|played|ago|in a row)\b|\s+(?:is|are)\s+(?!(?:enough|plenty|fine|good|better|ideal|right|perfect|ok|okay)\b))`;
const ABSOLUTE = new RegExp(
  String.raw`\b${DESCRIBED}(${NUMBER})\+?(?:\s+|-)${STORIES}${TOPIC}${NOT_PAST}|\b(?:stories|items)\s*(?::|=|to)\s*(\d{1,3})\b`,
  "gi",
);
const RELATIVE = new RegExp(
  String.raw`\b(?:(add|drop|cut|remove|lose|trim)\s+)?(${NUMBER})\s+(?:(more|extra|additional|fewer|less)\s+)?(?:news\s+)?(?:stories|story|items|item)\b${TOPIC}`,
  "gi",
);

function numberOf(word: string): number {
  const text = word.toLowerCase().replace(/^a\s+/, "");
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "dozen") return 12;
  if (text === "half a dozen") return 6;
  const [tens, unit] = text.split(/[\s-]/);
  const ones = UNITS.split("|");
  const at = TENS.split("|").indexOf(tens ?? "");
  if (at < 0) return ones.indexOf(text) + 1;
  return (at + 2) * 10 + (unit ? ones.indexOf(unit) + 1 : 0);
}

/**
 * The story count the words name: a count, or a change to what aired. Null when they name none, or
 * two that disagree, so a guess never stands in for the listener.
 */
export function wordCount(text: string): { count: number } | { change: number } | null {
  const found = new Set<string>();
  for (const match of text.matchAll(RELATIVE)) {
    const [, verb, number, way] = match;
    if (!verb && !way) continue;
    const size = numberOf(number ?? "");
    const down = way ? /fewer|less/i.test(way) : !/add/i.test(verb ?? "");
    if (size > 0) found.add(`change:${down ? -size : size}`);
  }
  for (const match of text.matchAll(ABSOLUTE)) {
    const size = numberOf(match[1] ?? match[2] ?? "");
    // "drop 2 stories" is a change, read above; its "2" is not a count too.
    if (size > 0 && !/\b(?:add|drop|cut|remove|lose|trim)\s+$/i.test(text.slice(0, match.index)))
      found.add(`count:${size}`);
  }
  if (found.size !== 1) return null;
  const [kind, size] = [...found][0]?.split(":") ?? [];
  return kind === "count" ? { count: Number(size) } : { change: Number(size) };
}

/** The count the words name, from `aired` (Auto's count when unknown), held to what `minutes` can air. */
function namedCount(text: string, aired: number, minutes: number): number | null {
  const named = wordCount(text);
  if (!named) return null;
  const from = Number.isFinite(aired) ? aired : autoStories(minutes);
  const count = "count" in named ? named.count : from + named.change;
  return Math.max(FEWEST_STORIES, Math.min(mostStories(minutes), count));
}

/**
 * The length an untouched control shows: the asked one, a step along when the comment asks. What
 * Haiku proposed wins; the words decide when it has not answered. More stories than `aired` that
 * the asked length cannot hold take a longer one too, so the ask is never sent unchanged (D377), and
 * a count the words name takes the shortest length that holds it.
 */
export function desiredLength(
  asked: number,
  values: Values,
  text = "",
  aired = Number.NaN,
): number {
  const direction = values.length ?? wordLength(text);
  if (direction) return stepLength(asked, direction);
  const named = namedCount(text, aired, Math.max(...REGEN_LENGTHS));
  if (named !== null) {
    return (
      REGEN_LENGTHS.find((minutes) => minutes >= asked && mostStories(minutes) >= named) ?? asked
    );
  }
  const full =
    (values.stories ?? wordStories(text)) === "more" && stepStories(aired, "more", asked) <= aired;
  return full ? stepLength(asked, "longer") : asked;
}

/**
 * The count an untouched Stories control shows: the one the words name, else a step from what aired
 * (Auto's count when unknown) when the comment asks for more or fewer, else "" (Auto), as it is when
 * the count is Auto's. A named count beats what Haiku proposed, which only knows more or fewer.
 */
export function desiredStories(aired: number, minutes: number, values: Values, text = ""): string {
  const named = namedCount(text, aired, minutes);
  const way = values.stories ?? wordStories(text);
  const count =
    named ??
    (way ? stepStories(Number.isFinite(aired) ? aired : autoStories(minutes), way, minutes) : null);
  // A count equal to Auto's is Auto: the list offers that count only as Auto.
  return count === null || count === autoStories(minutes) ? "" : String(count);
}

/** Whether an untouched category is ticked: as it was made, or ticked because the comment wants it. */
export function desiredChip(label: string, madeOn: boolean, values: Values): boolean {
  return madeOn || values.add.includes(label);
}
