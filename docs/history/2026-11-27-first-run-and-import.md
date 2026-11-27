# First run, import and Add a show

2026-11-25 to 2026-11-27. Slice 6 of public podcasts; behaviour in [specs/podcasts.md](../specs/podcasts.md).

## Asked

Every canvas board for first run (steps 1 to 3), OPML import and export, a backup file, adding a show by link, and the History row and page. On 26 Nov the owner asked for Add a show to be forgiving: "a single field that works for everything". He picked the canvas's accent ring for picked shows (a new design system part), allowed the inline error on Add a show, then left the night's calls to the thread.

## What changed

- `/welcome`, `/welcome/shows`, `/welcome/import`: topics, then shows to follow (ShowPick, design system 0.19.0), then a file from another app. Done is kept under `singularity:first-run`.
- One Add a show field: a name searches; a link resolves on the server (`/api/podcasts/resolve`: the feed, its guid, where it moved, a page's alternate feeds and Apple ids, then the page's name); several links follow each; an OPML or backup imports. A link from elsewhere (`?link=`) offers its show and follows nothing until tapped.
- Import and export (OPML, or a backup with History) in Settings; History in Profile.

## Left

- A feed the index does not know cannot be added; topics never change the Daily.
- Phone checks: see state.md.
