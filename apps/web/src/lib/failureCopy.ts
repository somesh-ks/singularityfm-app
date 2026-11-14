/**
 * The sentences several failures share, said once: the forms, the podcast queue, the Regenerate sheet,
 * the topic lookup and the narration all reach for these, so a failure reads the same wherever it
 * happens. Plain cause, then what to do; no codes, no host names (copyGuard.test.ts).
 */

/** A server failure: the host stopped the request, so the action may have gone through. A failure with a reference adds it (lib/errorRef.ts). */
export const CRASHED =
  "Something broke on our side. It may have gone through, so check before trying again.";

/** A request the server could not read: the page is out of date. */
export const INVALID = "That didn't go through. Reload the page and try again.";

/** No answer from the site. The strip says "You are offline"; this says what to do about it. */
export const OFFLINE_RETRY = "You're offline. Try again when you're back online.";
