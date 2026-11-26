import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed addresses for the two routes that fetch a publisher's file: the cover and the episode
 * extras. The show, search and new-episodes answers name each file through our own route with a
 * keyed hash of its address, so those routes fetch only files our own answers listed and are never
 * an open proxy. The key is derived from the Podcast Index secret, so the routes need no setting of
 * their own; rotating that secret makes every old address a 403, which the next list answer replaces.
 */

const LABEL = "singularity-podcast-files-v1";

export type SignedKind =
  | "cover"
  | "transcript:json"
  | "transcript:vtt"
  | "transcript:srt"
  | "chapters";

export type Signer = (kind: SignedKind, url: string) => string;

export function createSigner(secret: string): Signer {
  const key = createHmac("sha256", secret).update(LABEL).digest();
  return (kind, url) =>
    createHmac("sha256", key).update(`${kind}\n${url}`).digest("base64url").slice(0, 22);
}

/** True when `signature` is the one `sign` gives `url` under `kind`. Constant time. */
export function verifySigned(
  sign: Signer,
  kind: SignedKind,
  url: string,
  signature: string,
): boolean {
  const expected = Buffer.from(sign(kind, url));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Our cover route's address for a publisher image, or null when there is none. */
export function coverAddress(sign: Signer, url: string | null | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const https = url.replace(/^http:/i, "https:");
  return `/api/podcasts/cover?u=${encodeURIComponent(https)}&s=${sign("cover", https)}`;
}

/** Our extras route's address for a transcript or chapters file. */
export function extrasAddress(
  sign: Signer,
  kind: Exclude<SignedKind, "cover">,
  url: string,
): string {
  const https = url.replace(/^http:/i, "https:");
  return `/api/podcasts/extras?k=${encodeURIComponent(kind)}&u=${encodeURIComponent(https)}&s=${sign(kind, https)}`;
}
