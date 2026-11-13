# The command center moves to its own repository

D382 steps 2b to 6, 10 to 13 November. Decision: [D392](../decisions/entries/D392.md).

- Step 2b (#795): the admin stopped reading the reader's folders. The settings rows moved into the design system (`styles/settings-rows.css`, 0.9.0), the health rows into `@singularityfm/contracts/health` (0.2.0), and the brand marks, Costs and Health sheets into the admin. Every admin page was diffed pixel for pixel at phone and desktop, light and dark; only the Experiments toast moved (now centred, his OK).
- Step 5: `git filter-repo --path apps/admin/ --path-rename apps/admin:` on a fresh clone of `main` from GitHub kept its 45 commits; one commit then made it stand alone. It takes contracts and the design system from npm, checks out the public app repository sparsely at build (`scripts/fetchApp.mjs`), and runs one CI job: gitleaks, audit, typecheck, lint, unit tests and the browser suite. He imported its ruleset and repointed the `singularity-admin` Vercel project; it went live on 12 November at 17:35.
- Step 6: this repository dropped `apps/admin`, its browser job, its type check, the cross-app import check (one app left) and the admin's two sheets in the style test. The Overview, Coverage and Experiments specs moved to the admin repository; Health and Costs stay here with the APIs they read.
- Left: the admin should run the design system's rules on its stylesheets; Coverage refreshes only on an admin deploy unless he adds a deploy hook.
