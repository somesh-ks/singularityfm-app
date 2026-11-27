/**
 * First run (Nov 12 plan, slice 6): three skippable steps at /welcome, /welcome/shows and
 * /welcome/import. Home (scripts/homePage.ts) sends a new device here once, until it finished or
 * skipped, and its Trending shelf reads what step 1 picks, which stays on this device. It never
 * edits the Daily's topics, which are the owner's config (D296) and need no first run.
 */

const DONE_KEY = "singularity:first-run";
const TOPICS_KEY = "singularity:first-run-topics";
/** The show the Add a show page added for step 3, which says so once (session only). */
export const FIRST_RUN_ADDED_KEY = "singularity:first-run-added";

/**
 * The topics step 1 offers, in the canvas's order, each with the Podcast Index category its
 * trending chart is asked for (canonicalTrending accepts letters, digits, spaces, & and -).
 */
export const FIRST_RUN_TOPICS = [
  { label: "AI", category: "Technology" },
  { label: "Business", category: "Business" },
  { label: "Culture", category: "Society" },
  { label: "Design", category: "Design" },
  { label: "Science", category: "Science" },
  { label: "Software Engineering", category: "Technology" },
  { label: "Sports", category: "Sports" },
  { label: "Technology", category: "Technology" },
  { label: "World", category: "News" },
  { label: "Health", category: "Health" },
  { label: "History", category: "History" },
  { label: "Comedy", category: "Comedy" },
] as const;

export type FirstRunTopic = (typeof FIRST_RUN_TOPICS)[number]["label"];

/** Ticked when step 1 opens: the app's own four, which the Daily already covers. */
export const FIRST_RUN_DEFAULTS: readonly FirstRunTopic[] = [
  "AI",
  "Design",
  "Software Engineering",
  "Technology",
];

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** True until this device finished or skipped first run. A browser with no storage is never sent. */
export function firstRunPending(): boolean {
  try {
    const store = storage();
    return store !== null && store.getItem(DONE_KEY) === null && !doneThisVisit();
  } catch {
    return false;
  }
}

/** Done kept for the tab when the device's storage is full, so Skip still ends first run. */
function doneThisVisit(): boolean {
  try {
    return sessionStorage.getItem(DONE_KEY) !== null;
  } catch {
    return false;
  }
}

export function markFirstRunDone(): void {
  const at = new Date().toISOString();
  try {
    storage()?.setItem(DONE_KEY, at);
  } catch {
    try {
      sessionStorage.setItem(DONE_KEY, at);
    } catch {
      // Neither store takes it: firstRunPending then reads storage it cannot write, and asks again.
    }
  }
}

/** The topic labels picked at step 1, in the offered order; empty before step 1. */
export function pickedTopics(): FirstRunTopic[] {
  try {
    const raw = storage()?.getItem(TOPICS_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return FIRST_RUN_TOPICS.map((topic) => topic.label).filter((label) => list.includes(label));
  } catch {
    return [];
  }
}

/** Whether step 1 was answered, so a saved empty pick is told from none yet. */
export function topicsSaved(): boolean {
  try {
    return storage()?.getItem(TOPICS_KEY) != null;
  } catch {
    return false;
  }
}

export function setPickedTopics(labels: readonly string[]): void {
  const known = FIRST_RUN_TOPICS.map((topic) => topic.label).filter((label) =>
    labels.includes(label),
  );
  try {
    storage()?.setItem(TOPICS_KEY, JSON.stringify(known));
  } catch {
    // Best effort.
  }
}

/** The Podcast Index categories behind the picked topics, each once, for the trending route. */
export function pickedCategories(labels: readonly string[] = pickedTopics()): string[] {
  const categories = FIRST_RUN_TOPICS.filter((topic) => labels.includes(topic.label)).map(
    (topic) => topic.category,
  );
  return [...new Set(categories)];
}
