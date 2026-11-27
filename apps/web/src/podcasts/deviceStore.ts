import type { EpisodeRow, ShowDetail } from "../server/podcasts/shapes";
import type { Following } from "./rules";

/**
 * Public shows on this device: the shows, their episode lists and what the listener did with them.
 * It is the browser's own database, because episode lists for a few dozen shows do not fit the
 * 5 MB key store the rest of the app uses. Nothing on a server can restore it (Nov 12 plan, "On
 * the device"), so:
 *
 * - every record carries `changed_at`, and a favorite taken back keeps its record with
 *   `favorite_at: null`, so two devices' copies can be merged later without guessing;
 * - an episode that was played, queued, favorited or downloaded is `pinned`: the queue, a reload
 *   and History hold only ids, and an id is worth nothing without its record, also for a show the
 *   listener does not follow;
 * - every call is best effort. A private window or a full disk leaves the app working from the
 *   network alone.
 *
 * A listening position and "Played" stay with the one reader every card already uses
 * (player/core/resume.ts), keyed by the episode's id, so a chip, a row and the player never disagree.
 * Persisted fields are snake_case.
 */

export const DB_NAME = "singularity-podcasts";
export const DB_VERSION = 1;
const SHOWS = "shows";
const EPISODES = "episodes";
const BY_SHOW = "by_show";

export interface StoredShow extends ShowDetail {
  id: number;
  /** ISO time the show was favorited; null when it is not a favorite (or no longer is). */
  favorite_at: string | null;
  /** The newest full episode when it was favorited (rules.ts, isNewEpisode). */
  newest_id: string | null;
  /** The speed last used on this show, or null for the default (owner, 2026-11-23). */
  speed: number | null;
  /** The episode of this show played last, so its Play resumes that one. */
  last_episode_id: string | null;
  /** ISO time the route's answer was stored. */
  fetched_at: string;
  changed_at: string;
}

export interface StoredEpisode extends EpisodeRow {
  /** Kept whatever happens to the show's list: something on the device points at this id. */
  pinned: boolean;
  favorite_at: string | null;
  /** Taken off Continue listening or New by hand. */
  dismissed: boolean;
  /** ISO time it last played for a minute or more: History's order. */
  listened_at: string | null;
  changed_at: string;
}

type Mode = "readonly" | "readwrite";

const now = (): string => new Date().toISOString();

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let opened: Promise<IDBDatabase | null> | null = null;

/** The database, opened once; null where the browser has none or refuses it. */
function open(): Promise<IDBDatabase | null> {
  opened ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SHOWS)) db.createObjectStore(SHOWS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(EPISODES)) {
          db.createObjectStore(EPISODES, { keyPath: "id" }).createIndex(BY_SHOW, "show_id");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

async function run<T>(
  stores: string[],
  mode: Mode,
  work: (tx: IDBTransaction) => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    const db = await open();
    if (!db) return fallback;
    const tx = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    // Both at once: a failed request rejects the work and the transaction, and each is observed.
    const [result] = await Promise.all([work(tx), done]);
    return result;
  } catch {
    return fallback;
  }
}

/** Tells every open view that what the device holds about shows changed. */
export const PODCASTS_CHANGED_EVENT = "singularity:podcasts-changed";

function announce(): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent(PODCASTS_CHANGED_EVENT));
}

export function getShow(id: number): Promise<StoredShow | null> {
  return run(
    [SHOWS],
    "readonly",
    async (tx) => (await request(tx.objectStore(SHOWS).get(id))) ?? null,
    null,
  );
}

export function getEpisode(id: string): Promise<StoredEpisode | null> {
  return run(
    [EPISODES],
    "readonly",
    async (tx) => (await request(tx.objectStore(EPISODES).get(id))) ?? null,
    null,
  );
}

/** A show's episodes as the device holds them, newest first. */
export function episodesOfShow(showId: number): Promise<StoredEpisode[]> {
  return run(
    [EPISODES],
    "readonly",
    async (tx) => {
      const rows: StoredEpisode[] = await request(
        tx.objectStore(EPISODES).index(BY_SHOW).getAll(showId),
      );
      return rows.sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
    },
    [],
  );
}

export function favoriteShows(): Promise<StoredShow[]> {
  return run(
    [SHOWS],
    "readonly",
    async (tx) => {
      const rows: StoredShow[] = await request(tx.objectStore(SHOWS).getAll());
      return rows.filter((show) => show.favorite_at !== null);
    },
    [],
  );
}

/**
 * Stores a route's answer for a show and its episodes. What the listener did (a favorite, a speed,
 * a pin, a dismissal) is kept; only the publisher's fields are replaced, so a moved audio address
 * reaches a three week old queue row.
 */
export function saveShow(show: ShowDetail, episodes: readonly EpisodeRow[]): Promise<void> {
  const showId = show.id;
  if (showId === null) return Promise.resolve();
  return run(
    [SHOWS, EPISODES],
    "readwrite",
    async (tx) => {
      const stamp = now();
      const shows = tx.objectStore(SHOWS);
      const before: StoredShow | undefined = await request(shows.get(showId));
      shows.put({
        favorite_at: null,
        newest_id: null,
        speed: null,
        last_episode_id: null,
        changed_at: stamp,
        ...before,
        ...show,
        id: showId,
        fetched_at: stamp,
      } satisfies StoredShow);
      const store = tx.objectStore(EPISODES);
      for (const episode of episodes) {
        const kept: StoredEpisode | undefined = await request(store.get(episode.id));
        store.put({
          pinned: false,
          favorite_at: null,
          dismissed: false,
          listened_at: null,
          changed_at: stamp,
          ...kept,
          ...episode,
          // The long list cuts notes shorter than the newest page gives them: the whole ones stay.
          description:
            kept && kept.description.length > episode.description.length
              ? kept.description
              : episode.description,
        } satisfies StoredEpisode);
      }
    },
    undefined,
  ).then(announce);
}

async function changeShow(
  id: number,
  change: (show: StoredShow) => Partial<StoredShow>,
): Promise<void> {
  await run(
    [SHOWS],
    "readwrite",
    async (tx) => {
      const store = tx.objectStore(SHOWS);
      const show: StoredShow | undefined = await request(store.get(id));
      if (show) store.put({ ...show, ...change(show), changed_at: now() });
    },
    undefined,
  );
  announce();
}

async function changeEpisode(
  id: string,
  change: (episode: StoredEpisode) => Partial<StoredEpisode>,
): Promise<void> {
  await run(
    [EPISODES],
    "readwrite",
    async (tx) => {
      const store = tx.objectStore(EPISODES);
      const episode: StoredEpisode | undefined = await request(store.get(id));
      if (episode) store.put({ ...episode, ...change(episode), changed_at: now() });
    },
    undefined,
  );
  announce();
}

/**
 * Favorites a show, or takes the favorite back. `newestId` is the newest full episode now: with the
 * time, it is where "new" starts (rules.ts). Taking it back keeps the record, every position and
 * every pinned episode. The first favorite asks the browser to keep this site's storage.
 */
export async function setShowFavorite(
  id: number,
  favorite: boolean,
  newestId: string | null,
): Promise<void> {
  await changeShow(id, (show) =>
    favorite
      ? show.favorite_at
        ? {}
        : { favorite_at: now(), newest_id: newestId }
      : { favorite_at: null, newest_id: null },
  );
  if (favorite) {
    try {
      await navigator.storage?.persist?.();
    } catch {
      // Best effort: the export file is the backup.
    }
  }
}

export function setShowSpeed(id: number, speed: number | null): Promise<void> {
  return changeShow(id, () => ({ speed }));
}

/** Something on the device now points at this episode: it stays whatever the show's list does. */
export function pinEpisode(id: string): Promise<void> {
  return changeEpisode(id, (episode) => (episode.pinned ? {} : { pinned: true }));
}

/** The episode has played for a minute: History holds it, and its show's Play resumes it. */
export async function noteListened(id: string, showId: number): Promise<void> {
  await changeEpisode(id, () => ({ pinned: true, listened_at: now(), dismissed: false }));
  await changeShow(showId, () => ({ last_episode_id: id }));
}

export function setEpisodeFavorite(id: string, favorite: boolean): Promise<void> {
  return changeEpisode(id, () => ({ pinned: true, favorite_at: favorite ? now() : null }));
}

export function setEpisodeDismissed(id: string, dismissed: boolean): Promise<void> {
  return changeEpisode(id, () => ({ dismissed }));
}

/** What `isNewEpisode` needs of a stored show. */
export function followingOf(show: StoredShow | null): Following | null {
  return show?.favorite_at ? { favorite_at: show.favorite_at, newest_id: show.newest_id } : null;
}
