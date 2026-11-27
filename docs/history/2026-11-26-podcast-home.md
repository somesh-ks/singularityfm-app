# Podcast Home at /

2026-11-26. D402; slice 5 of the public podcasts plan.

## Asked

Build every Home and navigation board of the 12 Nov canvas: the speed dial with filter chips, Continue listening, the Catchups band, the shelves, the Library's Favorites and Shows chips, hold menus with Pin and Not interested, and the tinted band in Settings for the app's own podcasts. The owner picked "Home at /, Latest at /latest" by card, and the Continue card has no dismiss X.

## What changed

`/` is Home; the briefing moved to `/latest` with its Back to Home. Dial tiles and Continue cards open their menus by hold through `cardHold.ts`, by right click on desktop. The design system gained the dial, resume card, shell and band parts it needed (DS #106). About 100 browser tests moved to `/latest`.

## How it was checked

Unit tests for the Continue shelf and the dial order, shown red first. Both browser suites, compared with the merged base so other branches' failures are told apart. Stills at phone and desktop, light and dark, reviewed by a second model while the owner was away.

## Open

Covers are flat colours in the stills: the cloud container cannot reach the artwork hosts. Real covers wait for a check on the live site.
