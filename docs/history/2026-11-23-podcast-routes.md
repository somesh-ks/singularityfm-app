# Public podcast routes, slice 1 (2026-11-23)

The owner chose to start podcasts phase 1 now, in parallel with the design system parts (card, 23 Nov). This is slice 1 of the Nov 12 plan, built to the Nov 23 architecture plan: six read-only routes, the audio rule in the security policy, and the hidden switch (D396).

- Routes live in `apps/web/src/pages/api/podcasts/`, logic in `apps/web/src/server/podcasts/`. They reuse the source preview's outbound guard, the site icon's capped read and the shared Neon rate counter.
- Kept at the edge by `Vercel-CDN-Cache-Control` with stale-while-revalidate and stale-if-error, the pattern of D318. Failures are `no-store`.
- Left for later slices: the feed fallback for shows the index lacks (with pasting a feed address), sponsor marks (slice 8), and the `has: cookie` rewrite that the switch feeds (the slice with the new Home).
- The key names are added to `scripts/pushSecrets.ts` in their own pull request, because secret handling merges only by the owner.
- Not checked: no live call to Podcast Index or Apple (the session's network blocks both, and the keys are not on Vercel yet). The response shapes follow the index's API documents, read 23 Nov.

## Parked

Moved from `docs/state.md` for its size budget, still open:

- `podcast.yml` no longer installs ffmpeg; its first stage starts 9 s in (29 s before). closed when: 9 s is accepted.
