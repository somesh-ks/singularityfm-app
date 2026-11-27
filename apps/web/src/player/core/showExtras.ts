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
    if (!digest || !show || enriched(digest) || asked === digest.id) return;
    if (!show.chapters && !show.transcript) return;
    asked = digest.id;
    void loadExtras(digest.id, show).then((extras) => {
      const now = store.getState().track?.digest;
      // Another item took the player while the files were read, or this one already has them.
      if (!now || now.id !== digest.id || enriched(now)) return;
      if (extras.chapters.length === 0 && extras.segments.length === 0) {
        // Nothing came back (offline): a later load of this item asks again.
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
  const offSkip = store.onSecond(() => {
    const now = store.getTime();
    const before = last;
    last = now;
    const state = store.getState();
    if (preferences.get().sponsors !== "skip" || state.status !== "playing" || state.scrubbing)
      return;
    const span = currentBreak(store);
    if (!span) return;
    const playedInto = before < span.start_s && now - before <= 3 * Math.max(1, state.rate);
    if (playedInto) skipBreak(store, span, "auto");
  });
  return () => {
    offEnrich();
    offSkip();
  };
}
