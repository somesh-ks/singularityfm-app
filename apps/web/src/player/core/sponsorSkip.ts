import { sendToast } from "@singularityfm/design-system/toastEvent";
import {
  breakAt,
  LENGTH_TOLERANCE_S,
  type SponsorBreak,
  transcriptFitsAudio,
} from "../../podcasts/sponsors";
import type { PlayerStore } from "./playerTypes";

/**
 * Whether, and where, the player may skip a public show's sponsor break: kept apart from the code
 * that reads the extras (showExtras.ts), so the bar's Skip sponsor costs the player's first load
 * only these few lines.
 */

/** The breaks the player may act on now: none until the file it plays is known to fit them. */
export function trustedBreaks(store: PlayerStore): readonly SponsorBreak[] {
  const digest = store.getState().track?.digest;
  const breaks = digest?.show?.breaks;
  if (!digest || !breaks || breaks.length === 0) return [];
  const audioS = store.measuredDuration();
  const feedS = digest.audio?.duration_ms ? digest.audio.duration_ms / 1000 : null;
  const end = digest.show?.transcript_end_s ?? null;
  // Breaks from the publisher's chapters alone have no transcript to measure: the feed's length is
  // the one check, so it must be there and agree.
  const fits =
    end === null
      ? feedS !== null && audioS > 0 && Math.abs(audioS - feedS) <= LENGTH_TOLERANCE_S
      : transcriptFitsAudio({ audioS, feedS, transcriptEndS: end });
  return fits ? breaks : [];
}

/** The break the playhead is in, when the player may offer to skip it. */
export function currentBreak(store: PlayerStore): SponsorBreak | null {
  return breakAt(trustedBreaks(store), store.getTime());
}

/**
 * Jumps past a break. One skipped by itself says so on a short toast: no Undo, since a toast with an
 * action stays until it is used, and Back 15 or the scrubber return to the break.
 */
export function skipBreak(store: PlayerStore, span: SponsorBreak, by: "user" | "auto"): void {
  store.seekTo(Math.round(span.end_s * 1000));
  if (by === "auto") sendToast({ message: "Skipped a sponsor break", oneLine: true });
}
