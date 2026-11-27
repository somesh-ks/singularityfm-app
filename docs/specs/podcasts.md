# Podcast pages, shows and episodes

What it does now. Reasons: D396, D403, D404; the flow spec of 2026-11-23; history: [2026-11-27](../history/2026-11-27-show-pages-and-headline-list.md), [sponsor skip](../history/2026-11-27-sponsor-skip.md).

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

- First run is three steps: topics, shows to follow (a picked show wears the accent ring), a file from another app. Each step can be skipped; done is kept under `singularity:first-run`. Home (`/`) sends a device there once, when it has no favorites, listens or History and is online; a device that already has any of those is marked done instead. Home's Trending shelf follows the first topic picked.
- Add a show takes one field: a name searches the index; a link is read on the server (`/api/podcasts/resolve`): a feed the index knows, its `podcast:guid`, where it moved, a page's alternate feeds and Apple ids, then the page's own name searched. Spotify and YouTube land on the name. One show found is followed; several are offered to pick. A link arriving by `?link=` offers its show and follows nothing until tapped. Several links follow each; an OPML or backup imports.
- Import reads OPML or the backup file; export writes either. The backup holds shows, episodes, positions and History. History lists what played a minute or more, by day.
- A feed the index does not know cannot be added.

## Not built

## Chapters, transcript and sponsor breaks (D404)

- The publisher's chapters and timed transcript come through `/api/podcasts/extras` and are read once per tab (`podcasts/extras.ts`). In the player the chapters are the timeline's items, so the scrubber marks, previous and next ("Previous chapter") and the list work as for a Catchup's stories; tabs are Chapters, Transcript, Up next, each only where it has something.
- A sponsor break is a publisher's chapter titled "Sponsor: ..." or "Ad break", or an ad read found in the transcript (`podcasts/sponsors.ts`): from a line that opens an ad ("brought to you by", "my sponsor") to the first address that names the sponsor ("workos.com"), within 150 s, at least 10 s long. No such address, no break: missing one is fine, cutting the show is not.
- Breaks are trusted only when the file is the transcript's file: measured length within 5 s of the feed's, and the transcript ending inside the file with at most 30 s after it (15 s when the feed gives no length). A host that inserts ads per listener fails this, and no skip shows.
- Settings, Show settings, Sponsor breaks: Skip button (default), Skip where found, Off. The episode page's switch is the same setting. With Skip where found a break the playhead plays into is skipped with a toast; one sought into plays.
- The episode page lists the chapters with the breaks in place; a row plays from its start.

## Not yet

Download for a show's episodes; accounts and sync (phase 3).
