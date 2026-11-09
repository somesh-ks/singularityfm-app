# Weekly switch off

2026-11-09. Thread: Weekly-run audit. D386.

## What happened

The weekly podcast due Sunday 8 Nov did not air. The Weekly switch had been off in the config store since 4 Nov 00:03 UTC, saved by one POST from the owner's phone; he confirmed it was a slip and switched it on again on 9 Nov. Vercel Cron called the route all 24 hours of 7 and 8 Nov and got 200; the GitHub fallback ran and the gate said no run due, because `decideRun` treats a switched-off weekly as never due.

## Why nothing caught it

Health counted a switched-off podcast as never overdue (the Sunday run at 16:17 UTC was green), and the Settings rows said "Sundays at 8" whatever the switch said. The daily has the same blind spot; it was on and on time (5, 7 and 9 Nov published).

## What changed

- `weekly_off` and `weekly_missed` health faults (`ops/healthChecks.ts`), bounded to the week after a weekly that aired, so an off weekly raises one alert and then goes quiet instead of standing red and stopping the heal.
- Settings rows for Daily and Weekly read "Off" when the switch is off, live after a save (`settingsSummary.ts`, `settingsSaved.ts`).

## Not done

The daily is not covered by the new fault; an off daily is read the same way and is on today. Revisit if it is ever switched off by mistake.
