import { autoStories, mostStories, STORY_COUNTS } from "@singularityfm/core/storyCount";

/**
 * The Stories control beside Length (D377), on every surface that sets a podcast's size: the counts
 * on offer, in order, with Auto among them where its count falls ("Auto (29)" between 25 and 30), so
 * the list, and the wheel a phone turns it on, reads as one run of numbers. On the wheel Auto is
 * its number alone (owner, 2026-11-06: the word Auto only in the list), so a count equal to Auto's
 * is left out, or the wheel would show it twice. A count the length cannot hold stays in the list
 * hidden and disabled, so a change of length can bring it back. Client-safe.
 */
export interface StoryOption {
  /** "" is Auto. */
  value: string;
  label: string;
  /** What the wheel shows in place of the label (data-wheel-text); only Auto has one. */
  wheel?: string;
  hidden: boolean;
}

export function storyOptions(minutes: number, extra?: number): StoryOption[] {
  const most = mostStories(minutes);
  const auto = autoStories(minutes);
  const counts: StoryOption[] = STORY_COUNTS.map((count) => ({
    value: String(count),
    label: String(count),
    hidden: count > most || count === auto,
  }));
  // A count asked for in words or saved before the fives ("12 stories") is offered too: the fives
  // make a pick easy, they are not a limit (owner, 2026-11-06).
  if (
    extra !== undefined &&
    Number.isInteger(extra) &&
    extra > 0 &&
    extra !== auto &&
    !STORY_COUNTS.includes(extra)
  ) {
    counts.push({ value: String(extra), label: String(extra), hidden: extra > most });
  }
  counts.push({ value: "", label: `Auto (${auto})`, wheel: String(auto), hidden: false });
  // In order of count, Auto where its count falls.
  const countOf = (entry: StoryOption): number => (entry.value === "" ? auto : Number(entry.value));
  return counts.sort((a, b) => countOf(a) - countOf(b) || (a.value === "" ? -1 : 1));
}

/**
 * What a Stories control shows for `want` among `options`: itself when offered, Auto when Auto now
 * equals it, else the most the length holds.
 */
export function heldStory(options: readonly StoryOption[], want: string): string {
  if (options.some((entry) => entry.value === want && !entry.hidden)) return want;
  if (options.find((entry) => entry.value === "")?.wheel === want) return "";
  return options.filter((entry) => !entry.hidden).at(-1)?.value ?? "";
}

/** The value a Stories control sends: null for Auto, else the count. */
export function storiesValue(value: string): number | null {
  return value === "" ? null : Number(value);
}

/**
 * The count one step from `from` along the counts this length holds: "more" is the next count at
 * least `STEP_GAP` above it, "fewer" the next that far below, so 29 aired steps to 35, not a 30 no
 * listener would hear. A step past either end stays at the end.
 */
const STEP_GAP = 2;
export function stepStories(from: number, direction: "more" | "fewer", minutes: number): number {
  const offered = STORY_COUNTS.filter((count) => count <= mostStories(minutes));
  if (offered.length === 0) return from;
  if (direction === "more")
    return offered.find((count) => count >= from + STEP_GAP) ?? (offered.at(-1) as number);
  return [...offered].reverse().find((count) => count <= from - STEP_GAP) ?? (offered[0] as number);
}

/**
 * Keeps a Stories select to what `minutes` holds: its options are `storyOptions` in order, Auto's
 * count and place follow the length, a count it cannot hold or that Auto now equals is hidden, and a
 * pick of one moves to Auto if they are equal, else to the most the length holds. `want` sets the
 * pick first (a Regenerate's comment), and is offered even when it is not one of the fives. Returns
 * whether the pick moved, so a page that saves on change can send it.
 */
export function fitStories(select: HTMLSelectElement, minutes: number, want?: string): boolean {
  const current = want ?? select.value;
  const options = storyOptions(minutes, current === "" ? undefined : Number(current));
  const byValue = new Map(Array.from(select.options, (option) => [option.value, option]));
  for (const entry of options) {
    const option = byValue.get(entry.value) ?? new Option(entry.label, entry.value);
    byValue.delete(entry.value);
    option.textContent = entry.label;
    if (entry.wheel) option.dataset.wheelText = entry.wheel;
    else delete option.dataset.wheelText;
    option.hidden = entry.hidden;
    option.disabled = entry.hidden;
    // Appending in order moves an option into place; it keeps its selection.
    select.append(option);
  }
  for (const stale of byValue.values()) stale.remove();
  const value = heldStory(options, current);
  const moved = value !== current || select.value !== value;
  if (moved) select.value = value;
  select.dispatchEvent(new Event("picker:sync"));
  return moved;
}
