# PostHog with opt-in replay

2026-11-23 to 2026-11-26. D400; behaviour in [specs/analytics.md](../specs/analytics.md).

## Asked

The owner wanted the stack for experimentation-led design reviewed with him: analytics, session data, heatmaps, A/B tests, flags. A comparison (Simple Analytics, Vercel and Cloudflare Web Analytics, PostHog, GrowthBook, Statsig, Vercel Flags) mapped the product research's validation plan to tools. He picked PostHog EU by card, and opt-in only for replay and a stored id.

## What changed

posthog-js (pinned 1.447.3, loaded at idle) counts every counted reader cookieless; "Help improve Singularity" on `/settings/privacy` opts in to a stored id, replay with inputs masked, and heatmaps. Traffic goes through `/api/ph` (vercel.json rewrites). New events `mute` and `read_end`. Console logs are kept out of replays in code, whatever the project setting says.

## How it was checked

A Playwright spike against a routed fake host: by default events carry `$posthog_cookieless` and nothing is stored; opt-in stores an id that survives a reload and loads the recorder; opt-out drops the id. Headless Chromium is filtered as a bot by posthog-js, so the spike set `opt_out_useragent_filter`. PostHog's project setting "cookieless server hash mode" was turned on in the owner's browser.

## Open

The rewrite is untried on Vercel; no "caught up" view exists yet for the closure test. A/B tests wait for sign-in and about 1,000 weekly readers.
