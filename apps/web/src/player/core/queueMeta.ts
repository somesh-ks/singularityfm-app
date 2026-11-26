import { episodeDigest } from "../../podcasts/episodeDigest";
import { isShowEpisodeId } from "../../podcasts/rules";
import type { PlayerDigestData } from "../../types/contracts";
import { readDigestData } from "./digestData";
import { longDateFromDigestId } from "./formatTime";
import { recordingCaption } from "./playerCopy";
import { queueItemUrl } from "./playQueue";

export interface QueueMeta {
  title: string;
  /** "Daily · 6 min", as the player says it under a recording with no stories. */
  caption: string;
  cover: PlayerDigestData["cover"];
  weekly: boolean;
}

function metaOf(data: PlayerDigestData): QueueMeta {
  // In a list the episode is the name and its show the quiet line; the bar has it the other way.
  if (data.show) {
    return {
      title: data.show.episode_title,
      caption: data.show.title,
      cover: data.cover,
      weekly: false,
    };
  }
  return {
    title: data.title || longDateFromDigestId(data.id),
    caption: recordingCaption(data),
    cover: data.cover,
    weekly: data.kind === "weekly",
  };
}

const known = new Map<string, QueueMeta | null>();
const digests = new Map<string, PlayerDigestData>();
const asked = new Map<string, Promise<QueueMeta | null>>();

/**
 * A queued item's full data once its page has been read: what the player plays it from, so an item
 * is started in place, with no page move.
 */
export function queueDigestFor(id: string): PlayerDigestData | null {
  return digests.get(id) ?? null;
}

/**
 * A show episode about to play: known at once, with no read, so its Play starts in the same turn
 * as the press and its queue row has a title from the first frame.
 */
export function rememberQueueDigest(data: PlayerDigestData): void {
  digests.set(data.id, data);
  known.set(data.id, metaOf(data));
}

/** Reads the item's page if it has not been read yet; null where it cannot be. */
export async function loadQueueDigest(id: string): Promise<PlayerDigestData | null> {
  await loadQueueMeta(id);
  return queueDigestFor(id);
}

/** What a queued item's row shows, once its page has said. Null until then, or if it never does. */
export function queueMetaFor(id: string): QueueMeta | null {
  return known.get(id) ?? null;
}

/**
 * Reads a queued item's title and cover from its own page, the same data the player plays it from.
 * Each page is asked once; the browser (and the service worker) usually holds it already.
 */
export function loadQueueMeta(id: string): Promise<QueueMeta | null> {
  const cached = asked.get(id);
  if (cached) return cached;
  // A show episode has no page of ours to read: its record is on the device, pinned there when it
  // was played or queued (podcasts/deviceStore.ts).
  const read: Promise<PlayerDigestData | null> = isShowEpisodeId(id)
    ? import("../../podcasts/deviceStore")
        .then((store) => store.getEpisode(id))
        .then((episode) => (episode ? episodeDigest(episode) : null))
    : fetch(queueItemUrl(id), { credentials: "same-origin" })
        .then((response) => (response.ok ? response.text() : ""))
        .then((html) =>
          html ? readDigestData(new DOMParser().parseFromString(html, "text/html")) : null,
        );
  const request = read
    .then((data) => {
      const meta = data ? metaOf(data) : null;
      known.set(id, meta);
      if (data) digests.set(id, data);
      return meta;
    })
    .catch(() => {
      // Offline or gone: ask again next time the row is drawn.
      asked.delete(id);
      return null;
    });
  asked.set(id, request);
  return request;
}
