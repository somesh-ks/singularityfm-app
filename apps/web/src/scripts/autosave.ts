/**
 * Settings save themselves. A change waits until the controls have been still for a moment, so a
 * few quick changes go as one, then every pending edit is sent (managePageSave.ts, loaded with the
 * first change). Saving is quiet, as a native setting is: the control already shows the change, and
 * a screen reader hears Saved (ManageChrome's live region). The app's Toast comes up only for what
 * needs the owner: what went wrong, with a Retry, and a removal, which waits longer with an Undo
 * because it is the one change that cannot be put back by changing it again. Hiding or leaving the
 * page sends what is waiting.
 */
import { sendToast } from "@singularityfm/design-system/toastEvent";
import { connectivity } from "../lib/connectivity";
import { appendOutbox } from "../lib/outbox";
import { CANNOT_KEEP, KEPT } from "../lib/saveCopy";
import type { Pending, SaveContext, SaveState } from "./managePageSave";

type Saver = typeof import("./managePageSave");

/**
 * Controls whose change has more to it than a value (a removal, a row that says Added): only the
 * sender, with its page code, can settle them, so with no sender they are not kept here.
 */
const NEEDS_SENDER =
  "[data-remove], .source-note, .source-announce, a[data-new-topic], [data-suggest]";

/**
 * The sending code could not be fetched (the device went offline before it was loaded): the changes
 * are put in the outbox from here, which needs no code of its own, so nothing the person changed is
 * lost and it goes out when the connection is back (D330). False when a change cannot be kept this way.
 */
function keepWithoutSender(changes: Map<string, Pending>): boolean {
  const waiting = [...changes.entries()];
  if (waiting.length === 0 || waiting.some(([, pending]) => pending.el.matches(NEEDS_SENDER))) {
    return false;
  }
  // One entry per change: the sender never splits one, and it carries the edits that must go with it.
  // Each one is settled as soon as it is kept, so a refusal part way leaves only the changes that
  // are not kept still pending, and one kept change is never also sent from the page.
  for (const [key, pending] of waiting) {
    if (!appendOutbox([pending.op, ...(pending.with ?? [])])) return false;
    pending.done?.();
    pending.el.dataset.was = pending.now;
    changes.delete(key);
  }
  return true;
}

/** How long the controls must be still before a save. */
export const SETTLE_MS = 1200;
/** How long a removal waits, with Undo in the toast, before it is sent. */
export const UNDO_MS = 5000;
/** The air kept between the control just changed and the toast over the page. */
const CLEAR_PX = 12;

export interface AutosaveOptions {
  /** What a pending removal is, for the toast that offers to undo it, or null when none is pending. */
  removing?(): string | null;
  /** Puts every pending removal back. */
  undo?(): void;
}

export interface Autosave {
  /** Something changed, or was put back: save once the controls are still. */
  changed(): void;
  /** Save what is waiting now. */
  now(): void;
}

/** Toasts asked for before the store loads are one: the latest. */
const TOAST_KEY = "autosave";
/** The toast that shows, for the air kept above the control just changed. */
const TOAST_OPEN = ".toast:popover-open";

/**
 * Wires the app's toast and the timers to `changes`. `settled` runs after each request that went
 * through: the page reads its controls again, so a change made meanwhile is still pending.
 */
export function mountAutosave(
  root: HTMLElement,
  changes: Map<string, Pending>,
  settled: () => void,
  options: AutosaveOptions = {},
): Autosave {
  const live = root.querySelector<HTMLElement>("[data-live]");
  let still = 0;
  /** The sending module, once loaded: leaving the page needs it at once, not a promise later. */
  let saver: Saver | null = null;
  /** What this page's toast says and why, while it shows: it takes away only its own toast. */
  let shown: { message: string; state: SaveState } | null = null;
  /** The page is still open: a run that outlives a page swap has nothing to show. */
  const here = (): boolean => root.isConnected;
  const controlOf = (target: EventTarget | null): Element | null => {
    const control = (target as Element | null)?.closest?.("input, select, textarea, button");
    return control && root.contains(control) ? control : null;
  };
  /**
   * The control the owner last used, which the toast must not cover. It starts as the control that
   * has focus: a page can mount this during that control's first event (topicsPage.ts loads its
   * editor then), which has already passed the listeners below.
   */
  let touched: Element | null = controlOf(document.activeElement);
  const touch = (event: Event): void => {
    touched = controlOf(event.target) ?? touched;
  };
  root.addEventListener("change", touch);
  root.addEventListener("click", touch);

  /**
   * A button in the toast that is about to go (the toast hides, or its state hides the button) hands
   * focus to the control the toast is about, or to the page when that is gone, so the next Tab does
   * not start again from the top of the document.
   */
  const inToast = (): boolean => document.activeElement?.closest(TOAST_OPEN) != null;
  const handBack = (): void => {
    if (!inToast()) return;
    if (touched instanceof HTMLElement && touched.isConnected) touched.focus();
    if (inToast()) document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
  };

  /** Takes this page's toast away, if it still shows; another one's toast stays. */
  const hide = (): void => {
    if (!shown) return;
    handBack();
    sendToast({ dismiss: shown.message }, document, { key: TOAST_KEY });
    shown = null;
  };
  /** The toast went by the owner's hand (its action, its close button, a swipe). */
  const used = (then?: () => void) => (): void => {
    handBack();
    shown = null;
    then?.();
  };

  /**
   * The toast floats over the bottom of the page, where the control just changed may be. If it
   * lands on it, the page moves up by the overlap; manage.css keeps room under the last control
   * while the toast shows. A control in a dialog is above the page and needs nothing.
   */
  const reveal = (bar: HTMLElement): void => {
    if (!here() || !touched?.isConnected || touched.closest("dialog")) return;
    // Where the toast rests: its offset box, without the slide it enters with.
    const top =
      window.innerHeight - Number.parseFloat(getComputedStyle(bar).bottom) - bar.offsetHeight;
    const overlap = touched.getBoundingClientRect().bottom + CLEAR_PX - top;
    if (overlap <= 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({ top: overlap, behavior: reduce ? "instant" : "smooth" });
  };
  /**
   * Reveals the control once the toast shows `message`: it opens a frame or more after it is asked
   * for (the Toast is a React island), or already showed and only changed its words.
   */
  const revealWhenShown = (message: string): void => {
    const off = new AbortController();
    const check = (): void => {
      const toast = document.querySelector<HTMLElement>(TOAST_OPEN);
      if (!toast?.textContent?.includes(message)) return;
      off.abort();
      reveal(toast);
    };
    document.addEventListener("toggle", check, { capture: true, signal: off.signal });
    requestAnimationFrame(() => requestAnimationFrame(check));
    // A toast that never shows (no Popover API) leaves nothing to wait for.
    window.setTimeout(() => off.abort(), 1000);
  };

  const show = (message: string, state: SaveState): void => {
    if (!here()) return;
    // A save on its way or done takes this page's toast away: a failure it retries is no longer the news.
    if (state === "saving" || state === "saved") {
      if (live) live.textContent = state === "saved" ? message : "";
      hide();
      return;
    }
    // The Toast speaks its own words (an error as an alert), so the page's region stays quiet:
    // two regions would say the same words twice. An outcome to read goes by itself; Undo and
    // Retry stay until they are used or closed.
    if (live) live.textContent = "";
    shown = { message, state };
    sendToast(
      {
        message,
        ...(state === "done" ? { kind: "success" } : {}),
        ...(state === "error" ? { kind: "error", actionLabel: "Retry", onAction: used(now) } : {}),
        ...(state === "undo" ? { actionLabel: "Undo", onAction: used(options.undo) } : {}),
        onDismiss: used(),
      },
      document,
      { key: TOAST_KEY },
    );
    revealWhenShown(message);
  };

  const context: SaveContext = {
    changes,
    show,
    settled,
    here,
  };

  const now = (): void => {
    window.clearTimeout(still);
    if (changes.size === 0) return;
    void import("./managePageSave")
      .then((module) => {
        saver = module;
        module.adopt(context);
        return module.flush(context);
      })
      .catch(() => {
        // The sender could not be fetched: keep the changes for the connection, or say so and let Retry try again.
        // The code could not be fetched: the site cannot be reached, whatever the browser's flag says,
        // so the return is asked about and the kept changes go out when it comes.
        connectivity().reportUnreachable();
        if (keepWithoutSender(changes)) {
          settled();
          show(KEPT, "done");
        } else show(CANNOT_KEEP, "error");
      });
  };

  // The sender loads when the browser is idle, while the connection is there, so a change made after
  // it has gone reaches a request that fails with a message, not a chunk that cannot be fetched.
  const warm = (): void => {
    void import("./managePageSave")
      .then((module) => {
        saver ??= module;
        // A left page's run that failed before this page was ready: its changes wait here.
        module.adopt(context);
      })
      .catch(() => {});
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 4000 });
  else setTimeout(warm, 1500);

  // Leaving or hiding the page sends what is waiting; a request on its way finishes with keepalive.
  const off = new AbortController();
  // gone: the document may be closed (hidden, pagehide), so a change held in the server's gap goes to
  // the outbox now. A same-document swap (astro:before-preparation) keeps its run, and the next page.
  const leave = (gone: boolean): void => {
    if (changes.size === 0) return;
    now();
    // A run waiting out the server's gap carries on after the page goes: until it sends, the page
    // opened next shows these edits from storage rather than the old values.
    if (saver) {
      if (gone) saver.keepHeld(context);
      saver.keepWaiting(context);
    } else
      void import("./managePageSave").then((module) => {
        if (gone) module.keepHeld(context);
        module.keepWaiting(context);
      });
  };
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") leave(true);
    },
    { signal: off.signal },
  );
  window.addEventListener("pagehide", () => leave(true), { signal: off.signal });
  document.addEventListener("astro:before-preparation", () => leave(false), { signal: off.signal });
  // The Toast outlives a swap; what this page's toast offered stays with this page.
  document.addEventListener(
    "astro:after-swap",
    () => {
      hide();
      off.abort();
    },
    { signal: off.signal },
  );
  // A page left in the server's gap whose run then failed: this page takes its changes, says so in
  // its toast with Retry, and sends them with Retry or its next change (adopt).
  document.addEventListener(
    "singularity:held",
    () => void import("./managePageSave").then((module) => module.adopt(context)),
    { signal: off.signal },
  );

  return {
    changed() {
      // Loaded now, not at idle: a page left in the next moments must keep this change, marked
      // pending, with no wait for a chunk (leave).
      if (!saver)
        void import("./managePageSave")
          .then((module) => (saver ??= module))
          // A chunk that cannot be fetched is reported by now(), when the save is sent.
          .catch(() => {});
      window.clearTimeout(still);
      const removal = changes.size > 0 ? (options.removing?.() ?? null) : null;
      if (removal) show(removal, "undo");
      else if (shown?.state === "undo") hide();
      if (changes.size > 0) still = window.setTimeout(now, removal ? UNDO_MS : SETTLE_MS);
    },
    now,
  };
}
