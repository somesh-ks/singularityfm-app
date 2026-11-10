#!/bin/sh
# Vercel's ignoreCommand: exit 0 skips the build, exit 1 runs it. The batch rule (five merges, three
# hours, [deploy]) and the doubts that build live in ../../scripts/deploy-batch.sh (D375); this file
# is the list of what the admin draws with. It uses the design system (pinned in ./package.json, so a
# bump rebuilds it) and the reader's stylesheets
# and components, so a change there rebuilds it too. config/ is left
# out on purpose: a flag file changing in git need not cost a deploy, since the Experiments page
# lays the store's switches over the build's (2026-10-30, the owner). The switch function
# (api/experiments.ts) carries the store modules it imports by relative path, so each of those
# files rebuilds it.
exec sh ../../scripts/deploy-batch.sh -- \
  . \
  ../web/src/styles \
  ../web/src/components \
  ../../packages/contracts/src \
  ../../packages/engine/src/store/configPaths.ts \
  ../../packages/engine/src/store/experimentFlags.ts \
  ../../packages/engine/src/store/experimentHits.ts \
  ../../packages/engine/src/store/neon.ts \
  ../../packages/engine/src/store/pgErrors.ts \
  ../../packages/engine/src/store/runsStore.ts \
  ../../package.json \
  ../../pnpm-lock.yaml
