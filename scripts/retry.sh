#!/usr/bin/env bash
# Runs a command up to <tries> times with a growing pause, for a step that only reads the network (a
# registry, a browser download) and failed for a moment: a 5xx, a reset, a slow mirror. Never wrap a
# step that writes anywhere or judges the code. Usage: scripts/retry.sh <tries> <command...>
tries="$1"
shift
for attempt in $(seq 1 "$tries"); do
  if "$@"; then exit 0; fi
  if [ "$attempt" -lt "$tries" ]; then
    echo "::warning::'$*' failed (try $attempt of $tries); trying again in $((attempt * 15)) s"
    sleep $((attempt * 15))
  fi
done
echo "::error::'$*' failed $tries times. Read its output above; a registry or download that is down is cleared by re-running the job once it answers."
exit 1
