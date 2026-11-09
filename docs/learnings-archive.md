# Learnings archive

Older learnings moved out of [learnings.md](learnings.md) to keep it under its budget. Search it with grep; it is not read first. When learnings.md is within 500 bytes of its budget, move the oldest line of the longest section here instead of raising the budget.

## Agents and worktrees

- 2026-10-27: Windows junctions from `worktreeLinks.mjs` deleted the main checkout's `node_modules` twice: use `--remove` before `git worktree remove`.
- 2026-10-14: squash-merged branches never pass `git branch -d`, and auto mode refuses `-D`. Match commit subjects against main's squash bodies, keep a bundle of the heads in `.git/`, and let the owner force delete.
- 2026-10-12: cherry-pick a worker's non-merge commits (`git log --no-merges --reverse <lead>..<branch>`), then rerun `biome check`: formatting differences show on the combined tree.
- 2026-10-21: workers hit the 90-call cap: one piece each, WIP commit after the first pass. A finished worker's worktree stays locked: `remove -f -f`.
