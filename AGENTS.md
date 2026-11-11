# Singularity

Private design-engineering news briefing. A GitHub Actions engine writes a digest every second day, saves it to the content store, not git (D300), and Vercel deploys the reader at news.someshks.work. Repo: somesh-ks/singularityfm-app.

## Read first

1. [docs/state.md](docs/state.md): what works, what is unverified (each with `closed when:`), what is next. Rewritten, never appended.
2. [docs/learnings.md](docs/learnings.md): gotchas by area. Search it before debugging.
3. [docs/decisions/](docs/decisions/README.md): grep, never read the Index whole (old rows: `index-archive.md`).

On demand: [docs/specs/](docs/specs/README.md) for what a capability does (code and tests win; fix a wrong spec), [docs/history/](docs/history/README.md) for the why of a past change, and [the test postmortem](docs/engineering/postmortem-test-suite.md) before you add, change or delete a test. `node scripts/docsCheck.mjs` holds the budgets.

[docs/README.md](docs/README.md) maps every doc; [docs/runbook.md](docs/runbook.md) is owner setup. Before UI work, read the owner's taste in [the ledger core](docs/design-engineering-ledger.md), then your surface in [docs/ledger/](docs/ledger/README.md).

## Commands

- `pnpm run singularity <command>`: engine CLI (`doctor`, `status`, `models`, `run`, `publish`).
- `pnpm run gate --build`: typecheck, `astro check`, lint, unit tests, the docs check and the static build.
- Windows: PowerShell, not Git Bash. Cloud (Linux): `. /opt/nvm/nvm.sh && nvm install 24`, then `pnpm install --frozen-lockfile`, before any check. Never stop port 4321 (owner's dev server); browser suites take a `PORT` above 4400.
- A worktree gets packages from `pnpm install --frozen-lockfile --offline` inside it (seconds, hard links from the shared store); `git worktree remove` is then safe.
- `pnpm --filter @singularityfm/web run e2e` and `pnpm --filter @singularityfm/web run e2e:player`: the browser suites. Run both, one after the other (they share the build), before a PR that touches the site, `packages` or the tokens; push once. Red check: [delivery failures](docs/engineering/delivery-failures.md) (D148).
- Local build and dev server (`SINGULARITY_STATIC_ONLY=1 pnpm run build`, `pnpm run dev`): [learnings, Build and tooling](docs/learnings.md).

## Rules

- Never read, print or ask for key values. Keys live in the gitignored `.env`; `pnpm run secrets:push` sends them to GitHub and Vercel.
- Commits are Conventional Commits. Digest, state and config commits go through the write guard.
- No em dashes. Persisted data is snake_case; docs and config files are lowercase kebab-case.
- Do not edit `Digests/` or `state/` by hand.
- Merging: a PR merges itself once its review is clean, it is up to date with `main` and every required check is green, `.github/workflows`, `AGENTS.md` and design-system bumps included; a visual change keeps his OK on stills. Only he merges changes to branch rulesets, secret or env handling, npm publish or trusted-publisher permissions, and `CODEOWNERS` or the review config that gates merging: code-review.md, Who merges.
- Review before merge (D292): [code-review.md](docs/engineering/code-review.md). `[skip-review]` and green CI only if every file is Tier 0: docs outside `decisions/`, `engineering/`, `design/` and the ledger, test data, or a few-line copy fix outside Tier 2 (D254). Tier 2 (pipeline, store, auth, billing, workflows, design system, `AGENTS.md`, `.coderabbit.yaml`, gates): a review pass with your tool's review command (Claude Code: `/code-review`) before the PR. CodeRabbit does not review this repo on its own (under 10 stars, drafts skipped): `@coderabbitai review` asks for one, about one an hour (Free plan); Greptile (`@greptileai`, 50 free credits a month) backs it up on Tier 2 and rate-limited PRs. A cancelled CI run (newer push) is not a failure.
- TypeScript stays on 6.x.
- Change log (D355): CI fails a `feat`/`fix`/`perf` PR while `lib/changelog.ts` is over 2 days old.
- Scope: one PR per task per thread; review fixes and follow-ups go on its branch, never a new PR; batch small fixes (D254). Before a PR, `git diff --stat origin/main` must list only the task's files; name any shared stylesheet or component in it, and why, in the PR body.
- A visual change shows stills and gets his OK before the PR opens. Owner OK on stills: keep the PR mergeable (merge main in at each wake and before asking); a bare "ok" answers the latest ask. Ask in what he sees, never token names, with the default you will take, and keep building on it; stop only before a step that cannot be undone. State a paid probe's credit cost first.
- Reply to him in plain words (define a term the first time), short, with links he can open (artifact or PR, never a `/mnt` path); give numbered steps with URLs for what is missing, and say what is left. "Decide yourself" means decide. A click, setting or merge only he can do goes in `docs/state.md` Next with `closed when:`. Docs name tokens, never pixel values.
- State authority: the config store owns the owner's config; its files are not in git (D296). Edit in the app, never a PR; `config pull` fills `config/` locally.
- Pipeline discipline: verify the core daily loop runs green in production before adding new intake types or audience matrices.
- Vercel (pinned CLI): never deploy or edit env; read with `pnpm run vercel:logs`, `vercel:env-list`; call a merge live only once `vercel:list`, `vercel:inspect` or `/build.json` shows it. Production waits for 5 merges, 3 hours (hourly check; D375, D389) or a PR title ending `[deploy]`.

## Also loaded

Read [code.md](code.md) (code and tests) and [design.md](design.md) (the design system and UI work) before any work: they are part of these rules. Claude Code imports them through `CLAUDE.md`; every other tool must open them itself.

## Keeping the record

Project agents (`singularity-verify`, `singularity-worker`, `design-audit`) are in `.claude/agents/`, and `/close-session` runs the steps below; both are Claude Code only, so another tool reads the agent file as a checklist and does the steps by hand.

After a large piece of work: clean up scratch files, servers, stashes and local branches; review the merged diff (CodeRabbit), fix findings, verify the Vercel production deploy.

At the end of a session: update `docs/state.md`, add a decision (`pnpm run decision:next` gives the number, free on main and every pushed branch; write `decisions/entries/Dn.md` and push it at once, which claims it; never renumber after a rebase without asking him) for anything that changes direction, one line to `docs/learnings.md` per failure, and a note under `docs/history/`.
