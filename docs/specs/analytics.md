# Analytics

Cookieless counts of visits and a few named events on singularityfm.app, through Simple Analytics (D154) and PostHog (D400), so the owner can see which loops turn visitors into listeners and listeners into sharers. Nothing identifies a reader unless they opt in: no cookie, no storage, no IP, no user id. What a visitor is told is at `/settings/privacy`.

## Loading

- `apps/web/src/lib/analytics.ts` loads `https://scripts.simpleanalyticscdn.com/latest.js` once per session from `apps/web/src/scripts/app.ts`, on `singularityfm.app` alone: a preview, a local build and the browser suites load nothing.
- A browser that sends Do Not Track or Global Privacy Control never loads it.
- The script follows the client router's `pushState` moves as page views. Every page view carries `installed` (the app opened from the Home Screen).
- `track()` queues an event until the script loads, does nothing off production or blocked, never throws.
- The page policy (`apps/web/astro.config.mjs`) allows the script host in `script-src` and the queue host in `connect-src` and `img-src`; the header policy in `apps/web/vercel.json` repeats the last two (`apps/web/src/lib/analytics.test.ts` fails if it drops them). No inline script and no `'unsafe-inline'`: automated events and the `noscript` pixel are not used.

## PostHog (D400)

- `apps/web/src/scripts/productAnalytics.ts`, imported at idle by `app.ts` under `counted()` while `POSTHOG_TOKEN` (`lib/analytics.ts`) is set; `track()` sends each event to both tools, queued until PostHog loads.
- Cookieless (`cookieless_mode: on_reject`, opted out by default): events carry `$posthog_cookieless`, nothing is stored. "Help improve Singularity" on `/settings/privacy` (`singularity:improve`) opts in: a stored id, replay with inputs masked, heatmaps. Off again returns to cookieless and drops the id.
- It talks to `/api/ph`, rewritten in `apps/web/vercel.json` to PostHog's EU hosts.

## Events

| Event | When | Metadata |
| :--- | :--- | :--- |
| `share` | the share sheet completed, or the link was copied | `kind` briefing or episode, `item` its id, `outcome` shared or copied |
| `listen_start`, `listen_half`, `listen_complete` | an item starts, passes half its length while playing, ends; each once per item per session (`apps/web/src/player/core/listenEvents.ts`) | `kind` regular, weekly or on-demand, `item` its id |
| `story_open` | a story's source link is followed | `topic` |
| `vote` | a story is voted up or down (a press that clears a vote is not counted) | `value`, `topic` |
| `download` | a Library item is saved for offline listening | `kind` |
| `install` | the browser reports the app installed (`appinstalled`, Chromium only) | none |
| `create_episode` | Catch up got an answer | `outcome` started, limited (429) or failed |
| `mute` | a source is blocked | `kind` source |
| `read_end` | a briefing's end comes fully into view, once per page per session | `kind`, `item` |

A session that opens on a shared page ([sharing.md](sharing.md)) reports it as the path `/s` (`data-path-overwriter`, `lib/listenAnalytics.ts`): no token is sent.

A shared link carries `?ref=share`, reported as the referrer `share`. Pasted, a briefing or episode link draws a card (D153, `lib/linkCard.ts`); `checkBundle` fails a page without one.

## The loops and their numbers

North star: **listens a week**, the count of `listen_half`. A start counts accidental taps; a completion undercounts listeners who stop at the sign-off.

1. **Share loop** (acquisition). Share, a visit from `ref=share`, a listen, another share. Shares per visitor = `share` / unique visits; visits per share = visits with referrer `share` / `share`. Their product is the loop's coefficient: above 1 it grows on its own.
2. **Habit loop** (retention). A new briefing every second day brings the reader back. Without an identifier, retention is read from proxies: the share of page views with `installed` true, `install` counts, and visits with no referrer in the two days after a briefing is published.
3. **Taste loop** (quality). Listen, vote or open a story, the judge learns (D118), a better briefing. Listen-through = `listen_half` / `listen_start` by kind; completion = `listen_complete` / `listen_start`; `story_open` and `vote` by topic, up to down.
4. **Create loop** (activation). A visitor asks for an episode, gets one, shares it. `create_episode` limited / all is the share of demand the caps (D150) turn away.

What would change a decision:
- Listen-through under 50% for a kind: shorten its default length or move Top picks first.
- Limited over 10% of `create_episode`: raise the caps, or add accounts before more growth (narration and writing are paid per request, D137).
- `installed` page views flat while visits grow: acquisition without retention; work on the habit loop before more sharing.

## Opportunities not built

A one-line "what this is" on a first visit from `ref=share`; sharing a story or a moment from the player; a podcast feed; a share prompt when "Episode ready" shows.

## Field Web Vitals

Real visits' LCP, INP and CLS (D156), first-party like the fault reports, so a page that turns slow on real phones reaches `singularity health`. They take the opt-outs above (`counted()`: the production host, no Do Not Track, no Global Privacy Control).

- Where `counted()` allows, `apps/web/src/scripts/app.ts` loads `apps/web/src/scripts/vitals.ts` at idle or at the first visibility change. It reads the browser's PerformanceObserver (buffered) and sends one beacon to `/api/report` (kind `vitals`) when the page is first hidden, or at `pagehide` (a tab opened in the background, once it has been shown): the landing page's LCP (none painted after a hide), CLS and INP over the page's life to then (moves inside the app included), the route template (`vitalPage`: `/d/[id]`, `/e/[id]`, `/settings/categories/[id]`, a named page, else `other`), `device` (`mobile` for a coarse pointer) and `connection` (the effective type, Chromium only). Nothing else; a metric the browser does not measure is left out.
- The server applies the template and the bounds again, takes 30 a minute per instance apart from the faults' 30, and keeps one row per metric in Neon's `web_vitals` for 7 days (each insert and health's daily read delete what is older), 600 rows an hour at most. A store that is down or slow drops the sample; the beacon always gets 204.
- Faults (D158, not behind `counted()`) are also kept 7 days in Neon's `client_faults`: kind, route template, the message's start, CSP directive, blocked and source origins, build. A 5xx is kind `server`, or `platform` from Vercel.
- `singularity health` reads each metric's 7-day p75 per device class daily: `field_vitals` warns past Google's "needs improvement" line and faults past "poor"; `field_unmeasured` warns when phones gave a metric under 20 samples, `DATABASE_URL` is unset or the vitals read alone fails; a store that does not connect is the fault `store_degraded`.

## Limits

- Ad blockers block Simple Analytics' host, so its counts are a floor; PostHog's go through `/api/ph`.
- `Referrer-Policy: no-referrer`: a reload or full page load counts as a new unique visit; router moves do not.
- A listen offline (a download) sends nothing.
- The owner's own visits count unless excluded.
- An event from the page a shared link opened carries `ref=share`; one after a move inside the site does not.

## Code

- `apps/web/src/lib/analytics.ts`, `apps/web/src/scripts/productAnalytics.ts`, `apps/web/src/player/core/listenEvents.ts`, `apps/web/src/scripts/shareLink.ts`
- `apps/web/astro.config.mjs` and `apps/web/vercel.json` (the policies)
- `apps/web/src/pages/settings/privacy.astro`
- Field Web Vitals: `apps/web/src/scripts/vitals.ts`, `apps/web/src/server/vitals.ts`, `packages/core/src/vitals.ts`, `packages/engine/src/store/vitalsStore.ts`, `checkFieldVitals` in `packages/engine/src/ops/healthChecks.ts`
