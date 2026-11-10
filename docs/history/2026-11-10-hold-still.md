# A control holds still

2026-11-10. Thread: Layout shift. D388. Library: DS-9, DS-10.

## What happened

The owner saw the Play chip in the podcast header and the filter chip change width when an icon appeared or a word swapped, and asked for a fix that cannot come back. The first fix reserved a measured width (141.5px); he rejected it, since a measured pixel width goes stale and is the same hardcoding the system forbids.

## What changed

- Library (0.7.0): `reserve` on PlayChip, Button, Fab and a tonal Select; the widest words sit hidden in the same grid cell, so the box is as wide as them in every state. A browser test (`layoutStability.test.ts`) flips each state in three moods and both themes and fails on any change to the box, the words' place or the next element. `raw-px` fails a pixel length in a stylesheet.
- Processing: the waiting word on the Play chip and the Play button is "Processing" with a shimmer over the letters (a mask, so they keep their colour) and no spinner.
- App: the page rules that pinned the Play button's width and spinner display are gone; the Library sort chip and the admin Costs selects reserve their widest words; 17 pixel lengths became tokens, rem or the empty-state drawing unit.

## Not done

- Firefox was not checked; the shimmer is a CSS mask.
- The 14 page-level overrides into Fab and IconButton variants wait for the owner's OK (DS master plan thread).
