/**
 * The strips that depend on the device rather than on the build: offline, and for a moment back
 * online. They follow the one connectivity state (lib/connectivity.ts, D330) and nothing else. Each
 * is a Banner strip in the stack above the app (shell.css), which squeezes the page down while it
 * shows. Its markup is cloned from a <template> in the layout, so it has one home. Everything here
 * is progressive: without script the page reads the same, minus the strip.
 */
import { bannerText } from "@singularityfm/design-system/banner";
import { connectivity, type Link } from "../lib/connectivity";
import type { StripKey } from "../lib/stripMessages";

function bannerStack(): HTMLElement | null {
  return document.getElementById("banners");
}

/** The most the strip's close takes, in case its transition never ends (a hidden tab). */
const CLOSE_MS = 600;
let closeTimer: number | undefined;

/** What the strip is asked to say. `wanted()` picks one: the strip holds one condition at a time. */
let link: Link = "online";
let backOnline = false;
let audioLine: string | null = null;

function wanted(): StripKey | null {
  if (link === "offline") return "offline";
  if (backOnline) return "online";
  return audioLine ? "audio" : null;
}

/**
 * Opens the strip with one kind in it. An open strip keeps its height and swaps what it says (offline
 * to back online is one band, not two). The stack persists across moves inside the app (BaseLayout),
 * so a strip is drawn once and a page swapped in under it never redraws it.
 */
function show(kind: StripKey): void {
  const stack = bannerStack();
  const template = document.querySelector<HTMLTemplateElement>(`#banner-${kind}`);
  const source = template?.content.firstElementChild;
  if (!stack || !source) return;
  window.clearTimeout(closeTimer);
  document.documentElement.setAttribute("data-strip", "");
  let banner = stack.querySelector<HTMLElement>(`[data-banner="${kind}"]`);
  if (!banner) {
    banner = source.cloneNode(true) as HTMLElement;
    banner.dataset.banner = kind;
    stack.replaceChildren(banner);
  }
  // The player's line is its own words, kept in step while it shows.
  const title = banner.querySelector(`.${bannerText.title}`);
  if (kind === "audio" && title && audioLine && title.textContent !== audioLine) {
    title.textContent = audioLine;
  }
}

/**
 * Closes the strip. The page rises as it goes and the band leaves the way it came (shell.css), so its
 * contents stay until it is gone.
 */
function hide(): void {
  const stack = bannerStack();
  document.documentElement.removeAttribute("data-strip");
  if (!stack?.firstElementChild) return;
  window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => stack.replaceChildren(), CLOSE_MS);
}

function paint(): void {
  const kind = wanted();
  if (kind) show(kind);
  else hide();
}

let installed = false;

/** A failure that says the same words again is heard again: the line goes out and comes back. */
const REPEAT_GAP_MS = 100;
let repeatTimer: number | undefined;

/**
 * The player's one line when playback fails (null clears it). Offline and "back online" come first,
 * then this. `again` is a new failure: if its words are the ones showing, the
 * strip says them once more so a screen reader hears the second try fail too.
 */
export function setStripNotice(line: string | null, again = false): void {
  window.clearTimeout(repeatTimer);
  const repeats = again && line !== null && line === audioLine;
  audioLine = line;
  if (!installed) return;
  const title = repeats
    ? bannerStack()?.querySelector(`[data-banner="audio"] .${bannerText.title}`)
    : null;
  if (!title) {
    paint();
    return;
  }
  title.textContent = "";
  repeatTimer = window.setTimeout(paint, REPEAT_GAP_MS);
}

/** The banner's title says why (BaseLayout.astro); a disabled control points at it. */
const OFFLINE_REASON = "offline-reason";

/**
 * New episode needs the network from its first step, so offline every Create control is disabled
 * (aria-disabled, so it stays focusable and says why it does nothing) and opens no sheet. So is
 * the other action that starts a run from a page, a new briefing; an episode's Regenerate and Delete
 * follow the connection themselves (episodeActionsEntry.ts), since they also wait on a run.
 */
function syncCreate(isOffline: boolean): void {
  const starters = "[data-create-open], [data-open='generate']";
  for (const create of document.querySelectorAll<HTMLElement>(starters)) {
    if (isOffline) {
      create.setAttribute("aria-disabled", "true");
      create.setAttribute("aria-describedby", OFFLINE_REASON);
    } else {
      create.removeAttribute("aria-disabled");
      if (create.getAttribute("aria-describedby") === OFFLINE_REASON) {
        create.removeAttribute("aria-describedby");
      }
    }
  }
}

/** How long "Back online" stays before the strip closes. */
const BACK_ONLINE_MS = 2500;
let backOnlineTimer: number | undefined;

/** The play chips disable themselves offline (the player's readerSync); this only says why. */
function render(next: Link, previous: Link | null): void {
  link = next;
  const isOffline = next === "offline";
  document.documentElement.toggleAttribute("data-offline", isOffline);
  syncCreate(isOffline);
  window.clearTimeout(backOnlineTimer);
  // Only the moment the connection returns says so, not a page opened while online.
  backOnline = !isOffline && previous === "offline";
  if (backOnline) {
    backOnlineTimer = window.setTimeout(() => {
      backOnline = false;
      paint();
    }, BACK_ONLINE_MS);
  }
  paint();
}

export function installDeviceBanners(): void {
  if (installed) return;
  installed = true;
  const connection = connectivity();
  // A strip goes in before the page it belongs to shows, so the page is never pushed down after it
  // has drawn: on a first load the inline script has put it in (bannersInit.js) and this only
  // checks. The stack persists across moves, so a swap leaves the strip and its attributes alone;
  // the root's own are carried (navigation.ts) and a new page only has Create controls to mark.
  render(connection.link(), null);
  connection.subscribe((next, previous) => render(next, previous));
  document.addEventListener("astro:after-swap", () => syncCreate(connection.link() === "offline"));
  window.addEventListener("online", () => connection.hintOnline());
  window.addEventListener("offline", () => connection.hintOffline());
  // An app that slept through the connection's return hears no event: coming back to the front asks.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") connection.hintOnline();
  });
}
