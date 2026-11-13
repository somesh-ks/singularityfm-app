# Removing the git commit code, step 1

13 November. Follows D300 and [D381](../decisions/entries/D381.md): `Digests/`, `Podcasts/` and `state/` are ignored by git, and no bot commit has landed since 9 November (#776).

- Measured first: `git ls-files` lists none of the three folders, and the last commit under them is the one that stopped committing the run state.
- Step 1 of 3: `git/commit.ts` is now `saveRunState`, which saves the run state to Postgres for the commands that write it and does nothing else. The commit, push, rebase and conflict-merge code, the bot identity, the Conventional Commit check, `findDigestContentViolations` and `git/status.ts` are deleted, with the tests that built a real repository to exercise them.
- Kept on purpose: the write allowlists (`stateSave.ts` uses them as its guard), the pre-flight that refuses a run when the tree holds a change outside them, and `fastForwardToRemote`. Step 2 decides the last two.
- A finished commit stage now marks its plan done whatever the save returned. Before, only a commit marked it, and with nothing to commit a second commit stage would have published the run again.
- `podcast` no longer treats "nothing to commit" as a failure when the checkout has no content baseline; with no git commit there is nothing for that check to find.
- Step 2: drop `committed`, `pushed`, `refused` and the git push failures from `CommitOutcome`, the run report and its readers. Step 3: the dispatch fallback behind `config commit`, the `SINGULARITY_GIT_*` variables and the runbook lines about committing as the owner.
- Not verified: a scheduled run end to end in Actions. closed when: the next scheduled run's commit step ends green with `saved` or `nothing_to_commit` and the digest is in the store.
