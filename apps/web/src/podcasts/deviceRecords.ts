/**
 * The device store's reads and writes for History and the backup file (historyPage.ts, Home's first
 * run check, transfer.ts), apart from deviceStore so Search and the show pages do not load them
 * (first-load budget, D361).
 */

import {
  announce,
  EPISODES,
  request,
  run,
  SHOWS,
  type StoredEpisode,
  type StoredShow,
  transact,
} from "./deviceStore";

/**
 * Every show and episode the device holds, for the backup file (podcasts/backup.ts). Throws when
 * they cannot be read: a backup must never be saved empty by mistake.
 */
export function allRecords(): Promise<{ shows: StoredShow[]; episodes: StoredEpisode[] }> {
  return transact([SHOWS, EPISODES], "readonly", async (tx) => ({
    shows: await request<StoredShow[]>(tx.objectStore(SHOWS).getAll()),
    episodes: await request<StoredEpisode[]>(tx.objectStore(EPISODES).getAll()),
  }));
}

/** Takes the record with the later `changed_at`; the device's own on a tie. */
function newer<T extends { changed_at: string }>(mine: T | undefined, theirs: T): T | null {
  if (!mine) return theirs;
  return theirs.changed_at > mine.changed_at ? theirs : null;
}

/**
 * Merges records from a backup file into the device, record by record, the newest change winning
 * (Nov 12 plan, "Import and export"). Returns how many records changed; throws when the write
 * fails, so an import never reports what it did not keep.
 */
export async function mergeRecords(
  shows: readonly StoredShow[],
  episodes: readonly StoredEpisode[],
): Promise<number> {
  const changed = await transact([SHOWS, EPISODES], "readwrite", async (tx) => {
    let count = 0;
    const showStore = tx.objectStore(SHOWS);
    for (const show of shows) {
      const take = newer<StoredShow>(await request(showStore.get(show.id)), show);
      if (take) {
        showStore.put(take);
        count += 1;
      }
    }
    const episodeStore = tx.objectStore(EPISODES);
    for (const episode of episodes) {
      const take = newer<StoredEpisode>(await request(episodeStore.get(episode.id)), episode);
      if (take) {
        episodeStore.put(take);
        count += 1;
      }
    }
    return count;
  });
  if (changed > 0) announce();
  return changed;
}

/** Episodes played for a minute or more, last heard first: History's show episodes. */
export function listenedEpisodes(): Promise<StoredEpisode[]> {
  return run(
    [EPISODES],
    "readonly",
    async (tx) => {
      const rows: StoredEpisode[] = await request(tx.objectStore(EPISODES).getAll());
      return rows
        .filter((row) => row.listened_at !== null)
        .sort((a, b) => (b.listened_at ?? "").localeCompare(a.listened_at ?? ""));
    },
    [],
  );
}
