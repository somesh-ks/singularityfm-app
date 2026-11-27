# Podcast pages, shows and episodes

What it does now. Reasons: D396, D403; the flow spec of 2026-11-23; history: [2026-11-27](../history/2026-11-27-show-pages-and-headline-list.md).

## A Singularity podcast page (`/`, `/d/`, `/e/`)

- A story is one row: its start time, its headline, its publisher. The time is a text button that plays from that story (`data-play-item`, written by `readerSync.ts`); its name starts with the time it shows. It is hidden with no audio and while offline.
- The headline is the summary of a `<details>`: a press opens the story's summary, "Read the source" (a new tab; the publisher is in its name) and the votes. It opens with JavaScript off.
- The story being read has its time in the accent colour, and an outline in forced colours; nothing changes weight, so the headline holds still.
- No section tabs. Sections are headings. A strip with the cover and the podcast's name sticks where the tabs did, shows only once stuck, and a press on it scrolls to the top and focuses the title. The contents list beside the column stays on a wide screen.
- Play is the hero's button, and the floating one once the hero has scrolled away (D60).

## A show (`/show?id=`) and its episode (`/episode?id=`)

- Static shells: the script reads the id, asks the D396 routes and draws. A bad id or a failed load shows an empty screen with Try again.
- Header: cover, name, publisher, then heart, Play and Share; More at the header's corner opens the sheet (quick tiles Favorite, Add to queue, Share first).
- A show's Play resumes what is half heard, else the oldest new episode, else the first unplayed of a show told in order, else the newest; never a trailer or a bonus (`pickPlay`). Episode rows carry day, time, a New mark, length or time left, and a played check.
- An episode page shows its notes as plain paragraphs, an address in them a link, and Play.

## Rules (`podcasts/rules.ts`, one place)

- An id `pe:<feed id>:<hex>` is a show episode; anything else is a Catchup.
- Played: ended, or left inside the last twentieth of a show episode, three minutes at most. A Catchup keeps its three-second tail.
- New: published after the show was favorited, plus the newest at that moment.
- Skips: 15 back and 30 on in a show; a Catchup keeps ten each way. Speed is kept per show; all Catchups are one show.
- Up next after a show episode: the same show's next, then one from each other favorite show, then the two newest Catchups. Autoplay stays inside the show.
- The device store (`podcasts/deviceStore.ts`, IndexedDB) holds favorites, positions and history; whatever was played, queued or favorited keeps its record on the device.

## First run, Add a show, import (`/welcome`, `/add-show`, `/settings/import`, `/settings/history`)

- A first visit runs three steps: topics, shows to follow (a picked show wears the accent ring), a file from another app. Each step can be skipped; done is kept under `singularity:first-run`.
- Add a show takes one field: a name searches the index; a link is read on the server (`/api/podcasts/resolve`): a feed the index knows, its `podcast:guid`, where it moved, a page's alternate feeds and Apple ids, then the page's own name searched. Spotify and YouTube land on the name. One show found is followed; several are offered to pick. A link arriving by `?link=` offers its show and follows nothing until tapped. Several links follow each; an OPML or backup imports.
- Import reads OPML or the backup file; export writes either. The backup holds shows, episodes, positions and History. History lists what played a minute or more, by day.
- A feed the index does not know cannot be added.

## Not built

A transcript tab, chapters and Download for a show's episodes; accounts and sync (phase 3).
