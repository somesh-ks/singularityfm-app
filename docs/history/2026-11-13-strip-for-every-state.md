# One home for every state

13 November. Decision: [D394](../decisions/entries/D394.md).

- The owner saw the player's red "Audio isn't available" block during the Blob outage, and "Showing saved content" under the page. The audit found offline wording written seven ways, four status elements outside the strip, and a saved page that stayed cached after the store returned.
- Strip: `lib/stripMessages.ts` is the registry (offline, online, the player's line); `deviceBanners.ts` shows one by priority. The strip overlays the top of the player page, so the cover keeps its size.
- Player: a recording with no audio shows an empty screen; other failures go on the strip; `PlayerNotice` and its tests are gone.
- Outage: the saved-copy strip is gone. A page drawn on request answers 503 with `pages/unavailable.astro` instead of older podcasts; the stand-in script asks again on a gap and on Try again. A daily or monthly narration limit is a toast, not a strip (owner, 13 Nov).
- Guard: `houseRules.test.ts` lists every status element by file and count.
- Not done: the "controls did not load" fallback, the bare-text 503 and the voice list's offline sentence.
