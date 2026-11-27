/**
 * Home's rules (12 Nov canvas, Home board): which chip shows what, and the speed dial's order.
 * Pure, so the page and a test ask the same question once.
 */

export type HomeFilter = "catchups" | "shows" | "unplayed" | "downloaded";

/** The Library's chips: no All chip, a second press clears it, so none ticked shows everything. */
export const HOME_FILTERS: ReadonlyArray<{ id: HomeFilter; label: string }> = [
  { id: "catchups", label: "Catchups" },
  { id: "shows", label: "Shows" },
  { id: "unplayed", label: "Unplayed" },
  { id: "downloaded", label: "Downloaded" },
];

/** What one card, tile or row on Home is, as far as a chip asks. */
export interface HomeThing {
  kind: "catchup" | "show";
  played: boolean;
  downloaded: boolean;
}

/** Whether a chip keeps a thing on Home. A show's tile on the dial is never played or downloaded. */
export function shownBy(filter: HomeFilter | "all", thing: HomeThing): boolean {
  switch (filter) {
    case "catchups":
      return thing.kind === "catchup";
    case "shows":
      return thing.kind === "show";
    case "unplayed":
      return !thing.played;
    case "downloaded":
      return thing.downloaded;
    default:
      return true;
  }
}

/** One tile of the speed dial, as the order needs it. */
export interface DialEntry {
  /** The newest Daily: always first, always pinned. */
  first: boolean;
  /** ISO time the listener pinned it, or null. */
  pinnedAt: string | null;
  /** ISO time (or date) of its newest episode, or null. */
  newestAt: string | null;
}

const time = (iso: string | null): number => (iso ? Date.parse(iso) || 0 : 0);

/**
 * The dial's order: the newest Daily, then what the listener pinned (the first pin first, so a new
 * pin never pushes an old one off the first page), then the rest by their newest episode.
 */
export function dialOrder<T extends DialEntry>(tiles: readonly T[]): T[] {
  return [...tiles].sort((a, b) => {
    if (a.first !== b.first) return a.first ? -1 : 1;
    const pinA = a.pinnedAt !== null;
    const pinB = b.pinnedAt !== null;
    if (pinA !== pinB) return pinA ? -1 : 1;
    if (pinA && pinB) return time(a.pinnedAt) - time(b.pinnedAt);
    return time(b.newestAt) - time(a.newestAt);
  });
}

/** Tiles a page of the phone's dial holds: three rows of three. */
export const DIAL_PAGE = 9;

/** The dial cut into pages of nine. */
export function dialPages<T>(tiles: readonly T[], size = DIAL_PAGE): T[][] {
  const pages: T[][] = [];
  for (let at = 0; at < tiles.length; at += size) pages.push(tiles.slice(at, at + size));
  return pages;
}
