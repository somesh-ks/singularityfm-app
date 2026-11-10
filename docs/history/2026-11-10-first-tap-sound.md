# First tap sound

2026-11-10. Thread: Stop wrong sound on first tap.

## What happened

The owner heard a different sound on the first tap on his phone, one that reads as a task completed. Single taps on a fresh page sound right in the browser suite, so the cause is timing: a phone's audio device wakes slowly on the first press (about 200 ms, see learnings 2026-10-09), and the cues the press causes arrive before the context runs.

## Why

- The engine kept one cue while the context was suspended, the latest. A press brings several: its own tick, then the sheet it opens or the toast with a success cue, so the last one stood for all and the tap itself was never heard (a Play press heard as the sheet's cue alone).
- `play()` returned false for a held cue, so the page took it as not heard: no `singularity:cue`, and the echo guards (`cuePlayedSince`) did not see it, so the echo of the same press was not suppressed.
- Narration was judged when the held cue played, so a Play press's cues were skipped because narration had started in the wait.
- The controller's own wait for the engine to load kept only the latest cue as well, and kept one asked for with no press behind it.

## What changed

- `packages/sound/src/engine.ts`: a suspended context holds up to four cues, each with the level settled when it was asked, and plays them in order, as far apart as they were asked, when the resume lands (300 ms stale limit as before). `play()` returns true for a held cue. A new press (events more than a second apart) discards what was held before it began.
- `soundController.ts`: the wait for the engine keeps up to four cues in order and plays them with their spacing; a cue asked for with no press in the last 1.5 s is let go.
- Tests: five engine tests (two existing ones follow the new return value), one browser test with the audio device made slow to wake.

## Not done

A Play press before the engine has loaded still plays no cue of its own: player events do not wait for the load as interface cues do. Not heard on the owner's phone, so left.
