import type { EpisodeRow } from "../server/podcasts/shapes";
import { pinEpisode } from "./deviceStore";
import { episodeDigest } from "./episodeDigest";

/**
 * How a show's page and an episode's page reach the player. The player's code is loaded apart from
 * the page (it is most of the site's script) and ahead of the first press, because a phone refuses a
 * first play that starts after a wait.
 */

type Player = {
  runtime: typeof import("../player/core/playerRuntime");
  queueMeta: typeof import("../player/core/queueMeta");
  phone: typeof import("../player/core/openOnPhone");
};

let player: Player | null = null;
let loading: Promise<Player> | null = null;

/** Loads the player's code; a page calls it once it is idle. */
export function loadPlayer(): Promise<Player> {
  loading ??= Promise.all([
    import("../player/core/playerRuntime"),
    import("../player/core/queueMeta"),
    import("../player/core/openOnPhone"),
  ]).then(([runtime, queueMeta, phone]) => {
    player = { runtime, queueMeta, phone };
    return player;
  });
  return loading;
}

/** The episode in the player now and whether it is sounding; null before the player's code is in. */
export function nowPlaying(): { id: string | null; playing: boolean } | null {
  if (!player) return null;
  const state = player.runtime.getPlayerStore().getState();
  return {
    id: state.hasStarted ? state.digestId : null,
    playing: state.status === "playing" || state.status === "loading",
  };
}

/** Tells `listener` whenever what plays, or whether it plays, changes. */
export async function onPlayerChange(listener: () => void): Promise<() => void> {
  const { runtime } = await loadPlayer();
  return runtime.getPlayerStore().subscribe(listener);
}

/**
 * A press on an episode's Play: pauses it when it is the one sounding, else plays it in place,
 * from where it was left (the player's own resume). False when the episode has no audio that can
 * play here (an address that is not secure).
 */
export function pressPlay(episode: EpisodeRow): boolean {
  const digest = episodeDigest(episode);
  if (!digest) return false;
  const start = ({ runtime, queueMeta, phone }: Player): void => {
    const store = runtime.getPlayerStore();
    const state = store.getState();
    if (state.hasStarted && state.digestId === episode.id && nowPlaying()?.playing) {
      store.pause("user");
      return;
    }
    queueMeta.rememberQueueDigest(digest);
    runtime.playQueueItem(episode.id);
    phone.openPlayerOnPhone();
  };
  if (player) start(player);
  else void loadPlayer().then(start);
  // What plays is kept whatever its show's list does later (deviceStore.ts).
  void pinEpisode(episode.id);
  return true;
}

/**
 * Play next, or Add to queue: the episode goes first, or last, in what is to come. False when it
 * was there already, or is the one playing.
 */
export async function queueEpisode(episode: EpisodeRow, where: "next" | "last"): Promise<boolean> {
  const digest = episodeDigest(episode);
  if (!digest) return false;
  const { runtime, queueMeta } = await loadPlayer();
  queueMeta.rememberQueueDigest(digest);
  const queue = runtime.getPlayQueue();
  if (!queue.add(episode.id)) return false;
  void pinEpisode(episode.id);
  if (where === "next") {
    const view = queue.getView();
    // Every listed row in order (playQueue.ts, listedIds), spelled here so a page does not load the
    // queue's code with its own.
    const listed = [...view.above, ...(view.current ? [view.current] : []), ...view.upcoming];
    const rest = listed.filter((id) => id !== episode.id);
    const at = view.above.length + (view.current && rest.includes(view.current) ? 1 : 0);
    queue.arrange([...rest.slice(0, at), episode.id, ...rest.slice(at)]);
  }
  return true;
}
