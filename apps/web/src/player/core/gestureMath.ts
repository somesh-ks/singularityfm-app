import { TAP_SLOP_PX } from "@singularityfm/design-system/swipe";
import { clamp } from "./mathUtils";

// The sample ring, its velocity and the tap slop come from the design system's swipe rule, so the
// sheet, the queue rows and the Toast read one copy.
export type { Sample } from "@singularityfm/design-system/swipe";
export {
  createVelocityTracker,
  estimateVelocity,
  TAP_SLOP_PX,
} from "@singularityfm/design-system/swipe";

/** Converts a release velocity in px/ms to the spring's unit: progress per second. */
export function velocityToProgressPerSecond(pxPerMs: number, travelPx: number): number {
  if (travelPx <= 0) return 0;
  return (-pxPerMs * 1000) / travelPx;
}

export interface ReleaseThresholds {
  /** Fraction of the travel, downward, that dismisses on a slow lift. */
  distance: number;
  /** px/ms downward that counts as a flick. */
  velocity: number;
}

/** A press held longer than this is not a tap. The browser's own click decides what it was. */
export const TAP_MAX_MS = 500;

/** `reachPx` is the furthest the pointer got from where it went down, on either axis. */
export function isTap(reachPx: number, durationMs: number): boolean {
  return reachPx <= TAP_SLOP_PX && durationMs <= TAP_MAX_MS;
}

/**
 * Opening asks for less than closing. A pull up the whole screen is a long way, and opening by
 * mistake costs nothing; closing by mistake takes the player away.
 */
export const OPEN_DISTANCE = 0.25;
/** px/ms upward that counts as a flick open. */
export const OPEN_VELOCITY = 0.4;
/** A finger still moving back at this speed has changed its mind. */
const REVERSING_VELOCITY = 0.1;

export interface ReleaseInput {
  /** This gesture's own travel since it took hold, in px. Positive is downward. */
  travelPx: number;
  /** px/ms at the lift. Positive is downward. */
  velocityPxPerMs: number;
  /** Pixels between collapsed and expanded. */
  distancePx: number;
  /** Whether the page was committed open when the gesture took hold. */
  originOpen: boolean;
  /** The system ended the gesture: a cancel, or capture lost without a lift. */
  cancelled: boolean;
}

/**
 * Where a lift sends the page: 1 to expanded, 0 to collapsed. The decision reads only what this
 * gesture did. How far up the page happens to be is not part of it, so catching a rising page
 * can never read as "dragged most of the way down".
 *
 * A flick wins. Otherwise far enough travel wins, unless the finger was coming back. Otherwise the
 * page returns to where it was headed before the finger arrived.
 */
export function decideRelease(input: ReleaseInput, thresholds: ReleaseThresholds): 0 | 1 {
  const origin = input.originOpen ? 1 : 0;
  if (input.cancelled || input.distancePx <= 0) return origin;
  const velocity = input.velocityPxPerMs;
  if (velocity > thresholds.velocity) return 0;
  if (velocity < -OPEN_VELOCITY) return 1;
  const fraction = input.travelPx / input.distancePx;
  if (fraction > thresholds.distance && velocity > -REVERSING_VELOCITY) return 0;
  if (fraction < -OPEN_DISTANCE && velocity < REVERSING_VELOCITY) return 1;
  return origin;
}

/**
 * The page follows the finger one to one, from the value it had when the finger took hold, and
 * stops at both ends: it is never pulled above fully open or below the bar.
 */
export function progressFromDrag(
  startProgress: number,
  travelPx: number,
  distancePx: number,
): number {
  if (distancePx <= 0) return startProgress;
  return clamp(startProgress - travelPx / distancePx, 0, 1);
}
