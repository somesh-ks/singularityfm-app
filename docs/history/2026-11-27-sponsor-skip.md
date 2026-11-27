# Chapters, a transcript tab and sponsor skip for public shows

2026-11-27. D404; behaviour in [specs/podcasts.md](../specs/podcasts.md).

## Asked

Slice 8 of the public podcasts plan (canvas boards Episode and PlayerPublic, 12 Nov), with his question on the canvas whether a show's transcript can be its own tab. The owner was away overnight in autonomous mode.

## Measured

Transcripts and chapters of 20 real episodes, read through the live extras route: Lenny's Podcast, Latent Space, Darknet Diaries and Dwarkesh Podcast (5 each, one Dwarkesh with no transcript), and The Changelog's chapters, which title its ads "Sponsor: X".

| Show | Breaks marked | Into the show | Missed |
| --- | --- | --- | --- |
| Lenny's Podcast | 8 | 0 | 1 (WorkOS read with no opener line) |
| Latent Space | 4 | 0 | 0 |
| Dwarkesh Podcast | 5 | 0 | 1 (no address within 150 s) |
| Darknet Diaries | 0 | 0 | ads inserted per listener; the transcript has none |

The first rules took any address as a break's end: in a Latent Space episode an unrelated "bfl.ai" 100 s after "brought to you by Deepgram" would have skipped the guests' introductions. The address must now name the sponsor. A line that runs on past the address ends the break inside it.

Real files run 0 to 17 s past their transcript's last line, so 30 s (15 s with no feed length) is the allowance.

## What changed

- `podcasts/sponsors.ts`, `podcasts/extras.ts`: the rules and the shaping, pure and unit tested.
- The player: chapters as items, the Transcript tab (ScriptView with the publisher's speaker names), Skip sponsor, auto-skip loaded only for a show (`player/core/showExtras.ts`).
- The episode page: Sponsor breaks with its switch, Chapters with a Sponsor badge. Settings: Show settings, Sponsor breaks.
- The show route names each episode by its show: the index's episode list has no feed title, and the bar drew the episode's id.
- Design system 0.19.1 (DS PR #113): a button row in a card runs the card's width, and a row's divider in a card ends at its edge.

## Decided for him

Stills OKed after a second-opinion review (Opus): it caught chapter names shifting past an hour, "Sponsor" said twice beside the badge, and the setting's label wrapping; all fixed. Left for him: the Badge on a dark card is close to the card's tone (the 12 Nov rule chose that fill); the player's chapter list has no Sponsor badge (its list has no badge slot). Download for show episodes is its own PR: the service worker must fetch publishers' audio, which means a CSP change.

## How it was checked

Unit tests for the rules and shaping; a player browser test that Skip sponsor jumps past an ad and never shows on a file longer than the feed says (shown red first). Stills at phone and desktop, light and dark, on real Lenny's and Changelog data with silent audio of the right length. Not on his phone, and not on a live feed through the player.
