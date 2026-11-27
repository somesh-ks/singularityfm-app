import {
  PLAYED_KEY_PREFIX,
  playedKey,
  RECORDING_KEY_PREFIX,
  RESUME_KEY_PREFIX,
  recordingKey,
  resumeKey,
  safeLocalStorage,
} from "../player/core/resume";
import type { EpisodeRow } from "../server/podcasts/shapes";
import {
  BACKUP_MAX_BYTES,
  type BackupProblem,
  buildBackup,
  type Position,
  positionsToRestore,
  readBackup,
} from "./backup";
import { allRecords, favoriteShows, getShow, mergeRecords, setShowFavorite } from "./deviceStore";
import { catchupHistory, mergeListens, saveCatchupHistory } from "./history";
import { OPML_MAX_BYTES, type OpmlShow, parseOpml, writeOpml } from "./opml";
import { parseShowLink } from "./showLink";
import { fetchShow, findShow, resolveLink, type ShowAnswer, type ShowFailure } from "./shows";

/**
 * The browser side of import and export (Settings > Import and export, first run step 3): reads
 * the device, writes a file to save, and takes a file back in. The formats are backup.ts and
 * opml.ts; this only moves bytes.
 */

/** What the key store holds of every item: where it was left and whether it was heard. */
export function positionsOnDevice(): Record<string, Position> {
  const found: Record<string, Position> = {};
  try {
    // The whole store, not the player's slice of it: the keys are listed, not looked up.
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i) ?? "";
      const at = (prefix: string): string | null =>
        key.startsWith(prefix) ? key.slice(prefix.length) : null;
      const resumed = at(RESUME_KEY_PREFIX);
      const played = at(PLAYED_KEY_PREFIX);
      const id = resumed ?? played;
      if (!id) continue;
      found[id] ??= {};
      const position = found[id];
      if (resumed) position.seconds = Number(storage.getItem(key)) || undefined;
      if (played) position.played = true;
      const recording = storage.getItem(RECORDING_KEY_PREFIX + id);
      if (recording) position.recording = recording;
    }
  } catch {
    // Best effort: a backup without positions still carries the shows.
  }
  return found;
}

function download(name: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const day = (now: Date): string => now.toISOString().slice(0, 10);

/** Saves the backup file: shows, favorites, positions and History. */
export async function exportBackup(now = new Date()): Promise<void> {
  const { shows, episodes } = await allRecords();
  const backup = buildBackup({
    shows,
    episodes,
    positions: positionsOnDevice(),
    history: catchupHistory(),
    now,
  });
  download(
    `singularity-backup-${day(now)}.json`,
    "application/json",
    `${JSON.stringify(backup, null, 1)}\n`,
  );
}

/** Saves the favorite shows as OPML, for another podcast app. Returns how many. */
export async function exportOpml(now = new Date()): Promise<number> {
  const shows = await favoriteShows();
  const list: OpmlShow[] = shows
    .filter((show) => show.feed_url !== "")
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((show) => ({ title: show.title, feed_url: show.feed_url }));
  download(`singularity-shows-${day(now)}.opml`, "text/x-opml", writeOpml(list, now));
  return list.length;
}

/** The newest full episode now: where "new" starts for a show favorited this moment (rules.ts). */
export function newestFull(episodes: readonly Pick<EpisodeRow, "id" | "kind">[]): string | null {
  return episodes.find((episode) => episode.kind === "full")?.id ?? null;
}

/** Favorites a show the route found, unless it already is one. True when it was added. */
export async function follow(answer: ShowAnswer): Promise<boolean> {
  const id = answer.show.id;
  if (id === null) return false;
  if ((await getShow(id))?.favorite_at) return false;
  await setShowFavorite(id, true, newestFull(answer.episodes));
  return true;
}

export interface FollowResult {
  added: number;
  already: number;
  /** The shows the index did not know, by the name the file gave them. */
  missing: OpmlShow[];
  /** The ones the network or the route failed on: worth another try. */
  failed: OpmlShow[];
}

/**
 * A show by its feed address: the index's own lookup first; a feed it does not know by that address
 * is read by the server, which finds it by its guid or the address it moved to (resolve.ts). Only a
 * certain answer counts: a list of matches by name is not this show.
 */
export async function findOrResolve(url: string): Promise<ShowAnswer | ShowFailure> {
  const link = parseShowLink(url);
  if (link.kind === "apple") return findShow({ apple: link.id });
  const answer = await findShow({ url });
  if (answer !== "not_found") return answer;
  const resolved = await resolveLink(url);
  if (typeof resolved === "string") return resolved;
  return resolved.show?.id ? fetchShow(resolved.show.id) : "not_found";
}

/**
 * How long a failed lookup waits before its one retry: past the routes' per-minute caps (resolve's 30
 * a client), so a long list that ran into them is finished, not reported failed (Code review, 27 Nov).
 */
const RETRY_AFTER_MS = 61_000;

/** At most this many show lookups at once: kind to the route and to a phone's connection. */
const AT_ONCE = 4;

/** Finds and favorites every show of an OPML list, a few at a time. */
export async function followAll(
  shows: readonly OpmlShow[],
  progress: (done: number, total: number) => void = () => {},
): Promise<FollowResult> {
  const result: FollowResult = { added: 0, already: 0, missing: [], failed: [] };
  // Two entries for one show (its http and https address, an old and a new feed) count it once.
  const seen = new Set<number>();
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < shows.length) {
      const show = shows[next++] as OpmlShow;
      let answer = await findOrResolve(show.feed_url);
      // A busy route (its per-minute cap) or a dropped connection gets one more try, a little later.
      if (answer === "failed") {
        await new Promise((done) => setTimeout(done, RETRY_AFTER_MS));
        answer = await findOrResolve(show.feed_url);
      }
      if (answer === "not_found") result.missing.push(show);
      else if (answer === "failed") result.failed.push(show);
      else if (answer.show.id !== null && seen.has(answer.show.id)) result.already += 1;
      else {
        if (answer.show.id !== null) seen.add(answer.show.id);
        if (await follow(answer)) result.added += 1;
        else result.already += 1;
      }
      progress(++done, shows.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, shows.length) }, worker));
  return result;
}

export type ImportOutcome =
  | ({ kind: "opml" } & FollowResult)
  | { kind: "backup"; changed: number; positions: number; history: number }
  | { kind: "problem"; problem: BackupProblem | "too_large" | "empty_opml" };

/** Restores a backup file into the device, the newest change winning. */
async function restore(text: string): Promise<ImportOutcome> {
  const backup = readBackup(text);
  if (typeof backup === "string") return { kind: "problem", problem: backup };
  const changed = await mergeRecords(backup.shows, backup.episodes);
  const storage = safeLocalStorage();
  const restored = positionsToRestore(backup.positions, (id) => {
    try {
      return storage?.getItem(resumeKey(id)) !== null || storage?.getItem(playedKey(id)) !== null;
    } catch {
      return true;
    }
  });
  try {
    for (const [id, position] of Object.entries(restored)) {
      if (position.played) storage?.setItem(playedKey(id), "1");
      else if (position.seconds) storage?.setItem(resumeKey(id), String(position.seconds));
      if (position.recording) storage?.setItem(recordingKey(id), position.recording);
    }
  } catch {
    // Best effort, as every position write is.
  }
  const before = catchupHistory();
  const merged = mergeListens(before, backup.history);
  saveCatchupHistory(merged);
  return {
    kind: "backup",
    changed,
    positions: Object.keys(restored).length,
    history: merged.length - before.length,
  };
}

/**
 * Takes in a file the listener picked: an OPML list from another app, or this app's backup. The
 * file's content decides which, not its name, since phones rename downloads.
 */
export async function importFile(
  file: Blob,
  progress?: (done: number, total: number) => void,
): Promise<ImportOutcome> {
  if (file.size > Math.max(OPML_MAX_BYTES, BACKUP_MAX_BYTES)) {
    return { kind: "problem", problem: "too_large" };
  }
  const text = await file.text();
  // A backup is JSON; one whose words mention OPML is still a backup.
  if (text.trimStart().startsWith("{")) return restore(text);
  const opml = parseOpml(text);
  if (opml === null) return restore(text);
  if (file.size > OPML_MAX_BYTES) return { kind: "problem", problem: "too_large" };
  if (opml.length === 0) return { kind: "problem", problem: "empty_opml" };
  return { kind: "opml", ...(await followAll(opml, progress)) };
}
