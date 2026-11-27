import type { StorageLike } from "../player/core/resume";

/**
 * Home's Continue listening shelf: what was left half heard, the one heard last first. The position
 * itself stays with the one reader every card uses (player/core/resume.ts); this keeps only the
 * order, which the positions do not hold. The shelf clears itself (owner, 26 Nov: no Dismiss X): an
 * episode heard to the end leaves because its position does, and the shelf shows the few heard last.
 * Taking one off by hand is its own menu's Remove from Continue listening.
 */

export const CONTINUE_KEY = "singularity:continue";
/** How many the shelf shows: the most recent few. */
export const CONTINUE_SHOWN = 6;
/** How many the order remembers, so a few finished ones never leave the shelf short. */
const CONTINUE_KEPT = 24;

export interface ContinueEntry {
  id: string;
  /** Epoch ms of the last position saved. */
  at: number;
}

export function readContinue(storage: StorageLike | null): ContinueEntry[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(CONTINUE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ContinueEntry =>
        typeof entry?.id === "string" && typeof entry?.at === "number",
    );
  } catch {
    return [];
  }
}

function write(storage: StorageLike | null, entries: readonly ContinueEntry[]): void {
  try {
    storage?.setItem(CONTINUE_KEY, JSON.stringify(entries.slice(0, CONTINUE_KEPT)));
  } catch {
    // Best effort: the shelf is a convenience.
  }
}

/** A position was saved: the episode comes to the front (listening again brings it back too). */
export function noteContinue(storage: StorageLike | null, id: string, at = Date.now()): void {
  const rest = readContinue(storage).filter((entry) => entry.id !== id);
  write(storage, [{ id, at }, ...rest]);
}

/** Remove from Continue listening: off the shelf until its next position is saved. */
export function dropContinue(storage: StorageLike | null, id: string): void {
  const entries = readContinue(storage);
  if (entries.some((entry) => entry.id === id)) {
    write(
      storage,
      entries.filter((entry) => entry.id !== id),
    );
  }
}

/**
 * The ids the shelf shows, in order: half heard (a position, not played) and the few heard last.
 * `halfHeard` is the one reader's answer for an id.
 */
export function continueIds(
  entries: readonly ContinueEntry[],
  halfHeard: (id: string) => boolean,
  shown = CONTINUE_SHOWN,
): string[] {
  return entries
    .filter((entry) => halfHeard(entry.id))
    .slice(0, shown)
    .map((entry) => entry.id);
}
