import {
  GENERAL_TOPICS,
  NEW_PODCAST_FORMATS,
  PODCAST_LENGTHS,
  PODCAST_TONES,
  PODCAST_WINDOWS,
  topicGroupOf,
} from "@singularityfm/core";
import type { PodcastRequest } from "../types/contracts";

/**
 * What the Create page offers, and what it says about a choice. Build time only: the page script
 * ships to the browser on its own and reads the pace from the markup, so the two cannot drift.
 */

// The limits the server enforces, so the form can never offer more than it accepts.
export { MAX_TITLE_CHARS } from "../server/podcast";

const named = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

export const LENGTHS: ReadonlyArray<{ value: PodcastRequest["length_minutes"]; label: string }> =
  PODCAST_LENGTHS.map((value) => ({ value, label: `${value} min` }));

export const FORMATS: ReadonlyArray<{ value: PodcastRequest["format"]; label: string }> =
  NEW_PODCAST_FORMATS.map((value) => ({ value, label: named(value) }));

export const WINDOWS: ReadonlyArray<{ value: PodcastRequest["window_days"]; label: string }> =
  PODCAST_WINDOWS.map((value) => ({ value, label: `${value} days` }));

export const TONES: ReadonlyArray<{ value: PodcastRequest["tone"]; label: string }> =
  PODCAST_TONES.map((value) => ({ value, label: named(value) }));

export const DEFAULTS = {
  /** Every episode is written for the owner: the General audience is retired (2026-10-14). */
  audience: "custom",
  length: 5,
  format: "readout",
  window: 7,
  tone: "neutral",
} as const;

/** The button names what it makes; the Length control shows how long. */
export function submitLabel(): string {
  return "Generate catch up";
}

/**
 * The line under More options, naming the choices it holds: "Readout · Neutral tone". The markup
 * carries the template, so the page script fills the same words in as choices change. The format
 * and the tone go in by their labels; the voice is named under the format once the voices load.
 */
export const MORE_OPTIONS_TEMPLATE = "{format} · {tone} tone";

export function moreOptionsSummary(format: string, tone: string): string {
  return MORE_OPTIONS_TEMPLATE.replace("{format}", format).replace("{tone}", tone);
}

export interface TopicOption {
  /** The chip's key. For the owner's own topics it is the section id. */
  value: string;
  label: string;
  /** What the chip adds to the request: briefing section ids or general topic ids, in order. */
  ids: readonly string[];
  /** Ticked when the form opens: the owner's four, Design, AI, Technology and Software Engineering. */
  ticked: boolean;
}

/**
 * The chips every episode can draw on, in the order the form lists them. A chip expands to its ids when the form
 * builds the request, so topic_ids stay plain section or general topic ids. Design folds Design
 * Engineering in; Technology is the owner's own tech sources, not the general feeds. The general
 * chips (World and the rest) are not here: topicOptions makes them from config/topics.json. Top
 * picks is not here: an episode always opens with the top picks of its window.
 */
const CHIPS: readonly (TopicOption & { group: string })[] = [
  {
    value: "design",
    label: "Design",
    ids: ["design", "ui-craft"],
    ticked: true,
    group: "design",
  },
  { value: "ai", label: "AI", ids: ["ai"], ticked: true, group: "ai" },
  {
    value: "technology",
    label: "Technology",
    ids: ["tech"],
    ticked: true,
    group: "tech",
  },
  {
    value: "software",
    label: "Software Engineering",
    ids: ["software"],
    ticked: true,
    group: "software",
  },
];

/** What topicOptions needs to know of a topic in config/topics.json. */
export interface TopicInfo {
  id: string;
  name: string;
  section_id: string;
  origin: "builtin" | "app" | "custom" | "general";
  enabled: boolean;
  never_publish: boolean;
}

/**
 * The chips to offer: Design, AI, Technology and Software Engineering, then the general news topics that are on (World,
 * Business, Science, Culture, Sports, in the app's order, named as config/topics.json names them, so
 * a rename shows and a switched-off one is left out), then the owner's own topics (the custom ones
 * that are on), each by the section it publishes to and only when no chip already sends that
 * section. Their titles come from config/topics.json. Only the first four start ticked.
 */
export function topicOptions(
  sections: ReadonlyArray<{ id: string; title: string }>,
  topics: readonly TopicInfo[],
  /** Topic ids out of the Custom scope (config/schedule.json custom.skip_topics, D69). */
  skipped: readonly string[] = [],
): TopicOption[] {
  const titles = new Map(sections.map((section) => [section.id, section.title]));
  // A group's chip leaves the panel once every topic it gathers is out of the Custom scope.
  const out = new Set(skipped);
  const chips = CHIPS.filter((chip) => {
    const members = topics.filter((topic) => topicGroupOf(topic)?.id === chip.group);
    return members.length === 0 || !members.every((topic) => out.has(topic.id));
  }).map(({ group: _group, ...chip }) => chip);
  const general: TopicOption[] = [];
  for (const { id } of GENERAL_TOPICS) {
    const topic = topics.find((item) => item.origin === "general" && item.id === id);
    if (!topic?.enabled) continue;
    general.push({ value: id, label: topic.name, ids: [id], ticked: false });
  }
  const taken = new Set(["top", ...CHIPS.flatMap((chip) => chip.ids)]);
  const own: TopicOption[] = [];
  for (const topic of topics) {
    if (topic.origin !== "custom" || !topic.enabled || topic.never_publish) continue;
    if (out.has(topic.id)) continue;
    if (taken.has(topic.section_id)) continue;
    taken.add(topic.section_id);
    own.push({
      value: topic.section_id,
      label: titles.get(topic.section_id) ?? topic.name,
      ids: [topic.section_id],
      ticked: false,
    });
  }
  // Always alphabetical, whatever order the config lists them in.
  return [...chips, ...general, ...own].sort((a, b) => a.label.localeCompare(b.label));
}
