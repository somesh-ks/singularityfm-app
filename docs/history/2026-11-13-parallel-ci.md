# Parallel CI

13 November. Decision: [D393](../decisions/entries/D393.md).

- Measured first (run 43462570358): `check` 2.7 minutes, the player suite 8.5, the site suite 15, started only after `check`: 19 minutes for a site PR. Turborepo would have cached nothing here, since the time is the browser suite, not a task graph.
- A slow runner (Chromium install 83 s, not 17) pushed the whole site suite past its 30-minute cap on #810 and cancelled it; one re-run passed. That, not a code fault, is what the class table calls class 22.
- Now: a `changes` job, then `check` and five browser shards at once. `scripts/ciSuite.mjs` runs a shard and sorts a red one into `code`, `infra`, `flaky` or `unknown`; only `infra` reruns, once. The pnpm and Chromium installs retry. A `report` job keeps the single `browser-results` artifact the daily health check reads.
- Sentry was considered and left out: it watches the running app, not a CI run.
- Not verified until the PR's own run: that `gh run download` finds the shards' artifacts in the called workflow, that `--shard` splits the player suite evenly, and that the 15-minute cap holds on a slow runner.
