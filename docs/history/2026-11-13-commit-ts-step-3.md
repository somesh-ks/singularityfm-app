# Removing the git commit code, step 3

13 November, after [step 2](2026-11-13-commit-ts-step-2.md).

- Deleted: the `config.yml` workflow, `config commit` (and the `commit_message` that `config apply` reported only for it), the `config` and `learn` write-guard lists (nothing saved through them since D300), and the `SINGULARITY_GIT_NAME` and `SINGULARITY_GIT_EMAIL` variables from the workflows, `secrets:push`, `.env.example` and the runbook. `content.yml` no longer waits on `config`.
- Decided: `/api/config` with the config store off now answers 503. Before, it dispatched `config.yml`, which applied the edit to its checkout and committed nothing since step 1, so the page showed the edit as pending and it was lost. The store has been on in production since D296; the other path was dead.
- The tests of the dispatch path moved to the store path where they guard real behaviour: the RUN_CRON hour in Stockholm time, the variable created when missing, a refused variable, the cooldown and the token never reaching a log. The pure dispatch cases (the workflow input, the run lookup) went with the code.
- To remove by hand (his): the Actions variables `SINGULARITY_GIT_NAME` and `SINGULARITY_GIT_EMAIL` (Settings, Secrets and variables, Actions, Variables). Nothing reads them now.
