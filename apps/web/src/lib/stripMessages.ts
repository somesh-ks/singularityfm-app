import type { IconName } from "@singularityfm/design-system/icons";

/**
 * Every message the strip can show, in one place (BaseLayout draws a template for each, and
 * scripts/deviceBanners.ts shows them by key). A status a reader sees is a strip, an empty screen, a
 * toast or an inline field error (design.md); the strip takes one condition at a time, offline first,
 * then the saved copy, then the player's line. `houseRules.test.ts` fails on any other element that
 * says a status, so new text for the strip is a new line here.
 */
export type StripKey = "offline" | "online" | "saved-copy" | "audio";

export interface StripMessage {
  tone: "warning" | "success";
  icon: IconName;
  /** The glyph the icon is drawn over and strikes through (Wi-Fi, then Offline). */
  iconFrom?: IconName;
  /** The words. The player's line is its own words, set when it shows, so it starts empty. */
  title: string;
  /** An id for the line, so a control the strip explains can point at it (aria-describedby). */
  bodyId?: string;
}

export const STRIP: Record<StripKey, StripMessage> = {
  offline: {
    tone: "warning",
    icon: "wifiOff",
    iconFrom: "wifi",
    title: "You are offline",
    bodyId: "offline-reason",
  },
  online: { tone: "success", icon: "wifi", title: "Back online" },
  // The store did not answer, so the page was drawn from the podcasts built into the last deploy.
  "saved-copy": { tone: "warning", icon: "alert", title: "Showing older podcasts" },
  audio: { tone: "warning", icon: "alert", title: "" },
};

/** The page says it was drawn from the saved copy in a meta tag (BaseLayout), read again on each page. */
export const CONTENT_META = "singularity-content";
