import site from "../../../../site.json" with { type: "json" };
import { analyticsPath, isSharedPath } from "./listenAnalytics";

/**
 * Simple Analytics (D154): cookieless page views and a few named events, on the production site
 * alone. No cookie, no storage, no identifier: the script counts visits, referrers (a shared link's
 * `ref=share` among them), countries from the time zone, and time and scroll on a page. The events
 * below are the loops in docs/specs/analytics.md; each carries a kind, an outcome or an item's id,
 * never anything about the reader. A browser that sends Do Not Track or Global Privacy Control never
 * loads it.
 */

/** Only this host is counted: a preview, a local build and the browser suites load nothing. */
export const ANALYTICS_HOST = new URL(site.url).hostname;
/** Where the script comes from (the policy's script-src). */
export const ANALYTICS_SCRIPT_ORIGIN = "https://scripts.simpleanalyticscdn.com";
/** Where it sends page views and events, by beacon or, without one, an image (connect-src, img-src). */
export const ANALYTICS_QUEUE_ORIGIN = "https://queue.simpleanalyticscdn.com";

export type AnalyticsEvent =
  | "share"
  | "listen_start"
  | "listen_half"
  | "listen_complete"
  | "download"
  | "install"
  | "create_episode"
  | "vote"
  | "story_open"
  | "mute"
  | "read_end";

/**
 * PostHog's project token (D400). Public by design: it can only send events, and it ships in every
 * page. Empty means PostHog stays off.
 */
export const POSTHOG_TOKEN = "phc_pJydW8UkA6wLgCTFUaVgz3BxLMxKPdjhWLhC6xBLE8oy";
/** Our own address for PostHog, rewritten to its EU servers in vercel.json (no new policy host). */
export const POSTHOG_PROXY = "/api/ph";
/** "Help improve Singularity" on /settings/privacy: "1" while the reader has opted in. */
export const IMPROVE_KEY = "singularity:improve";

/** Whether this reader opted in to a stored id, replay and heatmaps. */
export function improving(): boolean {
  try {
    return localStorage.getItem(IMPROVE_KEY) === "1";
  } catch {
    return false;
  }
}

type ProductSink = (name: string, properties?: AnalyticsMetadata) => void;
let productSink: ProductSink | null = null;
const productQueue: [string, AnalyticsMetadata | undefined][] = [];

/** PostHog's capture, once it has loaded at idle; the events queued before it go first. */
export function connectProductSink(sink: ProductSink): void {
  productSink = sink;
  for (const [name, properties] of productQueue.splice(0)) sink(name, properties);
}

/** Simple Analytics takes flat text, numbers and booleans; nothing here may name a person. */
export type AnalyticsMetadata = Record<string, string | number | boolean>;

type SaEvent = ((name: string, metadata?: AnalyticsMetadata) => void) & { q?: unknown[][] };

/**
 * The global the script calls for the path of every page view and event, named by the script tag's
 * `data-path-overwriter` (Simple Analytics' "Overwrite path"). A shared page reports `/s`, so a
 * share token in its address never reaches the dashboard (D153, lib/listenAnalytics.ts).
 */
const PATH_OVERWRITER = "singularityAnalyticsPath";

interface AnalyticsWindow {
  sa_event?: SaEvent;
  sa_metadata?: AnalyticsMetadata;
  [PATH_OVERWRITER]?: () => string;
}

/** The query a shared link carries, so a visit it brings in is counted as a share. */
export const SHARE_REF = "share";

/** A shared address with `ref=share` on it, for the visit it brings to be counted as one. */
export function sharedUrl(address: string, base: string): string {
  const url = new URL(address, base);
  url.searchParams.set("ref", SHARE_REF);
  return url.href;
}

/**
 * The briefing or episode a shared address names: its kind and its id (`/d/<id>`, `/e/<id>`), so a
 * share is counted per item. Never anything about a person, and never a shared page's token: any
 * other address names no item.
 */
export function sharedItem(url: string): { kind: "briefing" | "episode"; item: string } {
  const [route = "", item = ""] = new URL(url).pathname.split("/").filter(Boolean);
  return {
    kind: route === "e" ? "episode" : "briefing",
    item: route === "d" || route === "e" ? item : "",
  };
}

/**
 * Whether this browser may be counted at all: on the production host, with no Do Not Track or Global
 * Privacy Control. Field Web Vitals (D156) take the same opt-outs.
 */
export function counted(): boolean {
  if (typeof window === "undefined" || window.location.hostname !== ANALYTICS_HOST) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack !== "1" && nav.globalPrivacyControl !== true;
}

/**
 * Counts one event. Safe to call anywhere: off production, with the script blocked (an ad blocker)
 * or before it loads, it queues or does nothing, and it never throws into the action that called it.
 */
export function track(name: AnalyticsEvent, metadata?: AnalyticsMetadata): void {
  if (!counted()) return;
  // Simple Analytics refuses an empty text value, so a field with nothing to say is left out.
  const fields =
    metadata && Object.fromEntries(Object.entries(metadata).filter(([, v]) => v !== ""));
  try {
    (window as unknown as AnalyticsWindow).sa_event?.(name, fields);
    if (!POSTHOG_TOKEN) return;
    if (productSink) productSink(name, fields);
    // Bounded: a reader whose PostHog never loads (blocked) keeps the first few, not a growing list.
    else if (productQueue.length < 50) productQueue.push([name, fields]);
  } catch {
    // The count is not worth a broken Share or Play.
  }
}

let installed = false;

/**
 * Loads the script once per session (the client router keeps this module, and the script follows
 * its pushState moves as page views). The queue stands in until it arrives, as its own placeholder
 * snippet does, so an event in the first second is not lost; the page metadata goes first because
 * the script reads it once, as it loads.
 */
export function installAnalytics(): void {
  if (installed || !counted()) return;
  installed = true;
  const target = window as unknown as AnalyticsWindow;
  // A session that opens on a shared page reports it as /s, and the pages it moves on to (by the
  // client router) as their own. Nothing in the app links to a shared page, so no other session
  // reaches one without a fresh load.
  const shared = isSharedPath(window.location.pathname ?? "");
  if (shared) target[PATH_OVERWRITER] = () => analyticsPath(window.location.pathname);
  // An installed app is a reader who came back: the one retention signal that needs no identifier.
  target.sa_metadata = { installed: matchMedia("(display-mode: standalone)").matches };
  if (!target.sa_event) {
    const queue: SaEvent = (...args) => {
      queue.q ??= [];
      queue.q.push(args);
    };
    target.sa_event = queue;
  }
  const script = document.createElement("script");
  script.async = true;
  script.src = `${ANALYTICS_SCRIPT_ORIGIN}/latest.js`;
  if (shared) script.setAttribute("data-path-overwriter", PATH_OVERWRITER);
  document.head.append(script);
}

const SHOW_ADDRESS = /(\/(?:show|episode))\?[^#\s]*/g;

/**
 * Takes the query off every /show and /episode address an event carries (the page, the referrer,
 * the session's first page): the id in it names a publisher's show or episode.
 */
export function withoutShowIds(properties: Record<string, unknown> | undefined): void {
  if (!properties) return;
  for (const [key, value] of Object.entries(properties))
    if (typeof value === "string" && value.includes("?"))
      properties[key] = value.replace(SHOW_ADDRESS, "$1");
}
