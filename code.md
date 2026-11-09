# Code and tests

Loaded every session with AGENTS.md. Rules for how to write and test code here.

## Code

The smallest complete change (Ponytail skill). First list every caller, test, fixture and config it must reach: that is scope, extra features are not. Then take the first option that fully works: skip it; reuse what the repo has, as it is used; the platform or an installed package (no new dependency for a few lines); one clear line; the minimum code.

- No abstraction, wrapper, option, config or "for later" code nobody asked for. Deletion beats addition; keep the repo's structure.
- Bug fix: grep every caller, then fix the root cause once in the shared code, with tokens and shared components, never a one-off or hardcoded value, and a check that flags drift. Moved code keeps its validation and error handling.
- A shortcut with a known limit gets `// shortcut: <the limit>, <when to upgrade>`.
- Never cut validation at trust boundaries, data-loss guards, security or accessibility.
- Say "done" only for what you ran; list the rest as unverified with `closed when:`. End the reply with what you skipped or did not check.

## Tests

Few, one layer each, aimed at what fails silently ([evidence](docs/engineering/postmortem-test-suite.md)).

- An owner-reported "it moves, shakes or jumps" fix gets one browser assertion that the thing holds still, comparing its box to itself, never to a pinned value.
- A test names the bug it prevents: no sentence, no test. Search the unit, `apps/web/e2e` and `apps/web/src/player/e2e` suites for the behaviour first, and extend or replace a test instead of adding one.
- Test journeys across pages, reload, offline and time, not states. Never pin copy, CSS, class names, markup, geometry or constants: screenshots and critics judge those.
- Fake the clock, crypto and network; freeze fixtures; never sleep or read live config. Assert a menu is open with `expect.poll` on `:popover-open`, not `toBeVisible` (it holds through the exit animation); install an animation slowdown before the first action.
- An existing test changes only with his OK, asked once per PR with the list; delete tests of removed behaviour in the same commit. Streamline tests in the PR: drop old assertions, fold overlaps. A test guards a real failure mode (owner, 11-03): show it red first, test where logic lives; never add one for coverage.
- A browser test runs once: on the phone unless it is tagged `@desktop` (desktop only) or `@both`. Counts and run times are in `docs/state.md`; a change that breaks the budget cuts first.
