# Show pages, episode pages and the headline list

2026-11-23 to 2026-11-27. D403; behaviour in [specs/podcasts.md](../specs/podcasts.md).

## Asked

The owner (23 Nov): the podcast layouts are good, but "micro details, logic, interactions, how things are connected, the whole user flow" must work. Slice 3 of public podcasts builds the show page, the episode page and the player's rules to the flow spec. On 26 Nov he also asked for a lighter Singularity podcast page: headlines with good timestamps, no Play on each story, no tabs, the name in a strip that sticks, Play still the floating button. He picked mock-up C by card, and then "OK, Catchup pages follow too".

## What changed

- `podcasts/`: the rules, the device store, a show's Play, what follows an episode, speed per show.
- `/show` and `/episode`: static shells over the D396 routes.
- The player takes a show episode: its skips, its speed, its lock-screen facts, Up next from the show, the other favorites and the Catchups.
- `Item.astro` is a time button and a `<details>`; `PodcastStrip.astro` takes the place of `SectionTabs` on a podcast page; `briefingPage.ts` lost the tab strip's fitting and reveal.
- Three `briefing.css` chip entries left `PAGE_OVERRIDES`.

## His notes on the stills, and what they became

Up next "to suggest better and more"; dividers full bleed; New after the time; the strip smaller; Play as the floating button. He left at 23:57 UTC on 26 Nov with "make all the decisions for me until morning". Decided for him: the round 2 stills and the test edits are OK; Download for publishers' episodes waits for its own slice; the Daily tile opens the briefing and plays; a show episode's transcript tab waits for chapters (slice 8).

## How it was checked

Unit tests for the rules and the show view. Both browser suites on fixtures; a new player suite `show.spec.ts`. Stills at phone and desktop, light and dark, in the gallery. Not on real feeds with his keys, and not on a phone.

## Learned

- A time that turns medium weight when its story plays moved the headline a third of a pixel; a colour change alone holds still.
- A button whose name does not start with its visible text fails axe (`label-content-name-mismatch`): the time's name starts with the time.
- `align-items: first baseline` lines a small time up with a larger headline without an off-grid margin.

## Open

A pause inside a show episode's last twentieth marks it played. Download, chapters and a transcript for a show's episodes are not built.
