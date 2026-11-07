#!/bin/sh
# Vercel's ignoreCommand: exit 0 skips the build, exit 1 runs it. The batch rule (five merges, three
# hours, [deploy]) and the doubts that build live in ../../scripts/deploy-batch.sh (D375); this file
# is the list of what the style guide draws with: the design system alone, so a change there rebuilds it too.
exec sh ../../scripts/deploy-batch.sh -- \
  . \
  ../../packages/design-system \
  ../../package.json \
  ../../pnpm-lock.yaml
