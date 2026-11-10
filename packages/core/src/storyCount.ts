import { VOICE_LIMITS } from "./voiceLimits.js";

/**
 * Story-count arithmetic, free of zod so the browser's Stories controls can load it
 * (`@singularityfm/core/storyCount`).
 */

/**
 * Spoken characters per story, its share of the frame (hello, section bridges, sign-off)
 * included: October 2026's seven briefings, 60 stories, 21,850 characters, 364 a story. The
 * writer's 40 to 95 word range keeps a story near this whatever the length.
 */
export const STORY_CHARS = 364;

/** The lengths, in minutes, a podcast or a scheduled briefing may ask for: one list for every check and control. */
export const PODCAST_LENGTHS = [3, 5, 10, 15] as const;

/**
 * Narration characters in a minute of a briefing: the four briefings narrated 2026-10-18 to
 * 10-24 ran 1,057 to 1,073 (`text_chars` over `duration_ms` in their `.audio.json`). Sized at
 * the podcast's 968, a full five-minute briefing aired about 4.5 minutes.
 */
export const BRIEFING_CHARS_PER_MINUTE = 1066;

/**
 * Narration characters a story costs beyond its own telling (a connective or a section bridge),
 * and the episode beyond its stories (the hello and the sign-off). Measured generously from
 * `buildSpokenText`, so an episode that fits here fits the narration request.
 */
export const STORY_FRAME_CHARS = 60;
export const EPISODE_FRAME_CHARS = 600;

/**
 * How many stories, in every section together, fill a briefing of this many minutes at the
 * narration's measured pace. Never fewer than the floor below which nothing publishes, never more
 * than the digest's hard cap.
 */
export function storiesForMinutes(minutes: number, floor: number, hardMax: number): number {
  const stories = Math.round((minutes * BRIEFING_CHARS_PER_MINUTE) / STORY_CHARS);
  return Math.max(floor, Math.min(hardMax, stories));
}

/**
 * The step between the counts the Stories control offers, and the count Auto rounds to: fives, so a
 * pick is easy (owner, 2026-11-06) and the wheel reads as one run (owner, 2026-11-10: it stopped at 44).
 */
export const STORY_STEP = 5;

/**
 * The numbers the Stories control offers, every step up to the digest's hard maximum, before those a
 * length cannot hold are left out. A count named in a Regenerate's words may land between them.
 */
export const STORY_COUNTS: readonly number[] = Array.from(
  { length: Math.floor(VOICE_LIMITS.items.hardMax / STORY_STEP) },
  (_, at) => (at + 1) * STORY_STEP,
);

/**
 * English speech runs about six characters a word, spaces included: 364 characters a story is about
 * 60 words. One value for the Stories control and the episode planner (podcast/plan.ts).
 */
export const CHARS_PER_WORD = 6;

/**
 * The shortest telling a picked count may squeeze a story to: about 20 words, one fact and why it
 * matters. Fewer words stop being a story, so a length holds no more stories than this allows.
 */
export const MIN_TELLING_WORDS = 20;

/** The stories a length holds at the usual telling, as `storiesForMinutes` sizes it. */
function pacedStories(minutes: number): number {
  return storiesForMinutes(minutes, VOICE_LIMITS.items.floor, VOICE_LIMITS.items.hardMax);
}

/**
 * The stories a length sizes at Auto: the usual telling's count to the nearest `STORY_STEP` (15
 * minutes holds 43.9, Auto is 45), so Auto is one of the counts on offer. What airs is still held to
 * the length (validation fills it by measured narration, D119), so the rounding moves no length.
 */
export function autoStories(minutes: number): number {
  const stepped = Math.round(pacedStories(minutes) / STORY_STEP) * STORY_STEP;
  return Math.max(VOICE_LIMITS.items.floor, Math.min(VOICE_LIMITS.items.hardMax, stepped));
}

/** The fewest stories a podcast airs: under this nothing publishes. */
export const FEWEST_STORIES = VOICE_LIMITS.items.floor;

/** The most stories a length holds, each told in `MIN_TELLING_WORDS`. */
export function mostStories(minutes: number): number {
  const room = minutes * BRIEFING_CHARS_PER_MINUTE - EPISODE_FRAME_CHARS;
  const story = MIN_TELLING_WORDS * CHARS_PER_WORD + STORY_FRAME_CHARS;
  return Math.max(
    VOICE_LIMITS.items.floor,
    Math.min(VOICE_LIMITS.items.hardMax, Math.floor(room / story)),
  );
}

/** The numbers the Stories control offers for a length: those it can hold. */
export function storyChoices(minutes: number): number[] {
  const most = mostStories(minutes);
  return STORY_COUNTS.filter((count) => count <= most);
}

/** The count an episode of this length airs: the picked one, held to what the length can hold. */
export function storiesFor(minutes: number, picked: number | null | undefined): number {
  return picked == null ? autoStories(minutes) : Math.min(picked, mostStories(minutes));
}

/**
 * The words each spoken telling aims at so `count` stories fit `minutes`: null when the usual
 * telling fits (no more stories than Auto), otherwise the share of the length a story has, never
 * under `MIN_TELLING_WORDS`.
 */
export function tellingWords(minutes: number, count: number): number | null {
  if (count <= autoStories(minutes)) return null;
  const room = minutes * BRIEFING_CHARS_PER_MINUTE - EPISODE_FRAME_CHARS;
  const share = room / count - STORY_FRAME_CHARS;
  return Math.max(MIN_TELLING_WORDS, Math.floor(share / CHARS_PER_WORD));
}
