/**
 * History (Nov 12 plan): what this device played for a minute or more, newest first. A show
 * episode's time is its `listened_at` in the device store; a Catchup's is kept here, in the key
 * store beside its position (player/core/resume.ts), since Catchups have no device-store record.
 */

export const CATCHUP_HISTORY_KEY = "singularity:history";
/** The most Catchups History keeps; the oldest go first. */
export const HISTORY_MAX = 300;

export interface CatchupListen {
  id: string;
  /** ISO time it last played for a minute. */
  at: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The Catchups heard, newest first. */
export function catchupHistory(
  store: Pick<Storage, "getItem"> | null = storage(),
): CatchupListen[] {
  try {
    const raw = store?.getItem(CATCHUP_HISTORY_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list.filter(
      (row): row is CatchupListen =>
        typeof row?.id === "string" && typeof row?.at === "string" && row.at !== "",
    );
  } catch {
    return [];
  }
}

/** Merges listens by id, the later time winning, newest first and capped. */
export function mergeListens(...lists: ReadonlyArray<readonly CatchupListen[]>): CatchupListen[] {
  const byId = new Map<string, CatchupListen>();
  for (const list of lists) {
    for (const row of list) {
      const kept = byId.get(row.id);
      if (!kept || row.at > kept.at) byId.set(row.id, { id: row.id, at: row.at });
    }
  }
  return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, HISTORY_MAX);
}

export function saveCatchupHistory(list: readonly CatchupListen[]): void {
  try {
    storage()?.setItem(CATCHUP_HISTORY_KEY, JSON.stringify(mergeListens(list)));
  } catch {
    // Best effort, like every other mark the player keeps.
  }
}

/** A Catchup has played for a minute in this tab (player/core/playerRuntime.ts). */
export function noteCatchupListened(id: string, at = new Date()): void {
  saveCatchupHistory(mergeListens(catchupHistory(), [{ id, at: at.toISOString() }]));
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_MS = 86_400_000;
const dayNumber = (date: Date): number =>
  Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);

/** History's heading for a listen's day, in the device's own time: "Today", "Yesterday", "Monday 9 November". */
export function historyDay(iso: string, now: Date): string {
  const at = new Date(iso);
  const days = dayNumber(now) - dayNumber(at);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const label = `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === now.getFullYear() ? label : `${label} ${at.getFullYear()}`;
}
