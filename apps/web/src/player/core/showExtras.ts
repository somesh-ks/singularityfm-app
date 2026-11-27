import { loadExtras, withExtras } from "../../podcasts/extras";
import type { PlayerDigestData } from "../../types/contracts";
import type { PlayerStore } from "./playerTypes";
import type { PreferencesStore } from "./preferences";
import { currentBreak, skipBreak } from "./sponsorSkip";

/**
 * A public show's episode gains its chapters, transcript and sponsor breaks once the extras route
 * answers, however it came to the player (a page's Play, the queue, a reload): the store takes the
 * richer copy in place and keeps playing (playerStore.ts, `load` of the same item). And where the
 * listener chose to skip sponsor breaks by themselves, a break the playhead reaches is skipped.
 */

const enriched = (digest: PlayerDigestData): boolean => digest.show?.breaks !== undefined;

export function startShowExtras(store: PlayerStore, preferences: PreferencesStore): () => void {
  let asked: string | null = null;
  const enrich = (): void => {
    const digest = store.getState().track?.digest;
    const show = digest?.show;
    // Another item took the player: the next time this one comes back bare, it is asked for again.
    if (digest?.id !== asked) asked = null;
    if (!digest || !show || enriched(digest) || asked === digest.id) return;
    if (!show.chapters && !show.transcript) return;
    asked = digest.id;
    void loadExtras(digest.id, show).then((extras) => {
      const now = store.getState().track?.digest;
      // Another item took the player while the files were read, or this one already has them.
      if (!now || now.id !== digest.id || enriched(now)) return;
      if (extras.partial) {
        // A file could not be reached (offline): a later change of the player asks again.
        asked = null;
        return;
      }
      store.load(withExtras(now, extras));
    });
  };
  enrich();
  const offEnrich = store.subscribe(enrich);

  // Skips by itself only a break the playhead reached by playing into it: a listener who sought into
  // a break meant to be there.
  let last = store.getTime();
  // Whether the listener put the playhead where the last tick left it (a seek, a chosen chapter): a
  // break that starts right there was chosen too. A load is not a choice, so Play at 0:00 still skips.
  let placed = false;
  const offSkip = store.onSecond((cause) => {
    const now = store.getTime();
    const before = last;
    last = now;
    const placedBefore = placed;
    placed = cause !== undefined && cause !== "auto" && cause !== "load";
    const state = store.getState();
    if (preferences.get().sponsors !== "skip" || state.status !== "playing" || state.scrubbing)
      return;
    const span = currentBreak(store);
    if (!span) return;
    // From before its start, or from its very start: a break at 0:00 is reached by pressing Play.
    // Only the episode playing there ("auto"): a seek across the start, however short, stays where
    // the listener put it.
    const playedInto =
      cause === "auto" && (before < span.start_s || (before === span.start_s && !placedBefore));
    if (playedInto) skipBreak(store, span, "auto");
  });
  return () => {
    offEnrich();
    offSkip();
  };
}
