# Removing the git commit code, step 2

13 November, after [step 1](2026-11-13-commit-ts-step-1.md).

- `CommitOutcome` is now `nothing_to_commit`, `saved` or `save_failed`. `committed`, `pushed`, `refused` and the git push failures are gone, with the run report's `sha` and `message`, and every reader of them (`commitStage`, `recordFailed`, `replace`, `publish`, `podcast`, `config`, the podcast failure reason, the report text, the `/digest` skill's CLI table). No workflow reads `commit.status`; the jq steps read `outcome` and `deploy`.
- Decided: the pre-flight that refused a run when the tree held a change outside the allowlist is deleted, in the commit stage and in `publish`. It protected a commit that no longer exists; the allowlists stay because `stateSave.ts` keeps its saves to them. `fastForwardToRemote` is deleted: it brought `state/` and `Digests/` up to date from the remote branch, and neither is in git.
- Found and fixed: a failed Regenerate put its stories back with `git checkout HEAD -- state/seen.json`, which does nothing when the file is not tracked, so the released stories stayed free for the next run to pick. The gate now keeps the released entries in `.cache/run/released-seen.json` and the failure record puts them back. The old test passed only because its fixture repository tracked `seen.json`.
- Not changed: the `/digest` skill still describes a local run that leaves a commit to push. That has been false since D300; it needs its own rewrite, not an edit here.
- Step 3 stays: the `config commit` dispatch fallback, the `SINGULARITY_GIT_*` variables and the runbook lines about committing as the owner.
