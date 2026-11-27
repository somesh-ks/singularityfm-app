import type { StoredEpisode, StoredShow } from "./deviceStore";
import { type CatchupListen, mergeListens } from "./history";
import { isShowEpisodeId } from "./rules";

/**
 * The backup file (Nov 12 plan, "Import and export"): favorites, the episodes something points at,
 * listening positions and History, in one JSON file. Nothing on a server can restore the device
 * store, so this file is the backup, and for now the way from a phone to a desktop. Import merges
 * it with what the device holds, the newest change winning. Pure: the page does the reading and
 * the writing (scripts/importPage.ts).
 */

export const BACKUP_FORMAT = "singularity-backup";
export const BACKUP_VERSION = 1;
/** A backup of a few hundred shows is well under this; a larger file is not ours. */
export const BACKUP_MAX_BYTES = 20 * 1024 * 1024;

/** Where an item was left, as the key store holds it (player/core/resume.ts). */
export interface Position {
  seconds?: number;
  played?: boolean;
  /** Which recording the position belongs to (a rewritten Catchup starts over). */
  recording?: string;
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exported_at: string;
  shows: StoredShow[];
  episodes: StoredEpisode[];
  positions: Record<string, Position>;
  history: CatchupListen[];
}

/** An episode worth carrying: the listener did something with it. The rest the route gives again. */
export function keptEpisode(episode: StoredEpisode): boolean {
  return (
    episode.pinned ||
    episode.favorite_at !== null ||
    episode.dismissed ||
    episode.listened_at !== null
  );
}

export function buildBackup(input: {
  shows: readonly StoredShow[];
  episodes: readonly StoredEpisode[];
  positions: Record<string, Position>;
  history: readonly CatchupListen[];
  now: Date;
}): Backup {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: input.now.toISOString(),
    shows: [...input.shows],
    episodes: input.episodes.filter(keptEpisode),
    positions: input.positions,
    history: [...input.history],
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));
const isTimeOrNull = (value: unknown): boolean => value === null || isTime(value);
/** A cover is our own route's address, never one a file chose (the security policy stays as is). */
const isCover = (value: unknown): boolean =>
  value === null || (typeof value === "string" && value.startsWith("/api/podcasts/cover?"));

function validShow(raw: unknown): raw is StoredShow {
  if (!isObject(raw)) return false;
  return (
    Number.isInteger(raw.id) &&
    (raw.id as number) > 0 &&
    typeof raw.title === "string" &&
    typeof raw.feed_url === "string" &&
    isCover(raw.cover) &&
    isTime(raw.changed_at) &&
    isTimeOrNull(raw.favorite_at)
  );
}

function validEpisode(raw: unknown): raw is StoredEpisode {
  if (!isObject(raw)) return false;
  return (
    typeof raw.id === "string" &&
    isShowEpisodeId(raw.id) &&
    Number.isInteger(raw.show_id) &&
    raw.id.startsWith(`pe:${raw.show_id}:`) &&
    typeof raw.title === "string" &&
    typeof raw.audio_url === "string" &&
    raw.audio_url.startsWith("https://") &&
    isCover(raw.cover) &&
    isTime(raw.changed_at) &&
    isTimeOrNull(raw.listened_at) &&
    typeof raw.pinned === "boolean"
  );
}

/** Catchup ids are dates or episode slugs; a show episode's is `pe:`. Nothing with a space or a colon run. */
const POSITION_ID = /^[\w.:-]{1,120}$/;

function validPositions(raw: unknown): Record<string, Position> {
  const kept: Record<string, Position> = {};
  if (!isObject(raw)) return kept;
  for (const [id, value] of Object.entries(raw)) {
    if (!POSITION_ID.test(id) || !isObject(value)) continue;
    const position: Position = {};
    if (typeof value.seconds === "number" && Number.isFinite(value.seconds) && value.seconds > 0) {
      position.seconds = Math.floor(value.seconds);
    }
    if (value.played === true) position.played = true;
    if (typeof value.recording === "string" && /^[0-9a-z]{1,16}$/.test(value.recording)) {
      position.recording = value.recording;
    }
    if (position.seconds !== undefined || position.played) kept[id] = position;
  }
  return kept;
}

/** A time as the store writes it (toISOString), so merges that compare times as text compare right. */
const iso = (value: unknown): string | null =>
  isTime(value) ? new Date(value).toISOString() : null;
const stringOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);
const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** A show as the store keeps it: its times in one form, each field it reads of the right type. */
function storedShow(raw: StoredShow): StoredShow {
  const speed = numberOrNull(raw.speed);
  return {
    ...raw,
    favorite_at: iso(raw.favorite_at),
    newest_id: stringOrNull(raw.newest_id),
    speed: speed !== null && speed >= 0.5 && speed <= 3 ? speed : null,
    last_episode_id: stringOrNull(raw.last_episode_id),
    fetched_at: iso(raw.fetched_at) ?? new Date(0).toISOString(),
    changed_at: iso(raw.changed_at) as string,
  };
}

function storedEpisode(raw: StoredEpisode): StoredEpisode {
  const duration = numberOrNull(raw.duration_s);
  return {
    ...raw,
    duration_s: duration !== null && duration >= 0 ? duration : null,
    favorite_at: iso(raw.favorite_at),
    dismissed: raw.dismissed === true,
    listened_at: iso(raw.listened_at),
    changed_at: iso(raw.changed_at) as string,
  };
}

export type BackupProblem = "not_json" | "not_backup" | "newer_version";

/**
 * Reads a backup file. A record that is not whole is left out rather than failing the file, so one
 * bad row never costs the listener the rest.
 */
export function readBackup(text: string): Backup | BackupProblem {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "not_json";
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) return "not_backup";
  if (typeof raw.version !== "number" || raw.version > BACKUP_VERSION) return "newer_version";
  const history = Array.isArray(raw.history)
    ? raw.history
        .filter(
          (row): row is CatchupListen =>
            isObject(row) &&
            typeof row.id === "string" &&
            POSITION_ID.test(row.id) &&
            isTime(row.at),
        )
        .map((row) => ({ id: row.id, at: iso(row.at) as string }))
    : [];
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exported_at: isTime(raw.exported_at) ? raw.exported_at : new Date(0).toISOString(),
    shows: Array.isArray(raw.shows) ? raw.shows.filter(validShow).map(storedShow) : [],
    episodes: Array.isArray(raw.episodes)
      ? raw.episodes.filter(validEpisode).map(storedEpisode)
      : [],
    positions: validPositions(raw.positions),
    history: mergeListens(history),
  };
}

/**
 * The positions to write: only for items the device has no memory of. A position has no time of
 * its own, so the device's own place, which is the one the listener last saw here, always stays.
 */
export function positionsToRestore(
  incoming: Record<string, Position>,
  has: (id: string) => boolean,
): Record<string, Position> {
  return Object.fromEntries(Object.entries(incoming).filter(([id]) => !has(id)));
}
