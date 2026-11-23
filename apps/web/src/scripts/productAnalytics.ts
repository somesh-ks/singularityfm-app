import posthog from "posthog-js";
import { connectProductSink, improving, POSTHOG_PROXY, POSTHOG_TOKEN } from "../lib/analytics";

/**
 * PostHog (D400), loaded lazily at idle so the first load carries none of it. Everyone is counted
 * cookieless: no cookie, no storage, no identifier; PostHog's server hashes the visit with a salt it
 * rotates daily, so two days cannot be joined. A reader who turns on "Help improve Singularity"
 * (/settings/privacy) opts in: a stored random id, session replay with every input masked, and
 * heatmaps, until they turn it off. Everything goes through our own address (`/api/ph`, rewritten
 * in vercel.json to PostHog's EU servers), so the page policy names no new host.
 */
let started = false;

export function startProductAnalytics(): void {
  if (started || !POSTHOG_TOKEN) return;
  started = true;
  const optedIn = improving();
  posthog.init(POSTHOG_TOKEN, {
    api_host: POSTHOG_PROXY,
    ui_host: "https://eu.posthog.com",
    // Declining (the default here) still counts, without storage or an identifier.
    cookieless_mode: "on_reject",
    opt_out_capturing_by_default: true,
    persistence: "localStorage",
    respect_dnt: true,
    // Page views follow the client router; clicks are not captured, only the named events.
    capture_pageview: "history_change",
    autocapture: false,
    disable_surveys: true,
    disable_web_experiments: true,
    // Heatmaps and replay need the stored id, so only an opted-in reader sends them.
    enable_heatmaps: optedIn,
    session_recording: { maskAllInputs: true, maskTextSelector: "input, textarea" },
    // The installed app is a reader who came back (docs/specs/analytics.md).
    loaded(instance) {
      instance.register({ installed: matchMedia("(display-mode: standalone)").matches });
      if (optedIn && instance.get_explicit_consent_status() !== "granted")
        instance.opt_in_capturing();
      connectProductSink((name, properties) => instance.capture(name, properties));
    },
  });
}

/** The Privacy page's switch: on stores an id and starts replay, off goes back to cookieless. */
export function setImproving(on: boolean): void {
  if (!started) return;
  if (on) {
    posthog.opt_in_capturing();
    posthog.set_config({ enable_heatmaps: true });
  } else {
    posthog.opt_out_capturing();
    posthog.set_config({ enable_heatmaps: false });
    posthog.stopSessionRecording();
  }
}
