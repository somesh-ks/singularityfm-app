import { showToast } from "@singularityfm/design-system/toastStore";
import type { RunRecord } from "../lib/runRecord";
import { briefingFailureLine } from "../lib/runStages";

/**
 * Says a run could not be made while the player's open page covers the podcast queue. Every other end
 * is the queue's to tell: a run that finished stays in it with Start listening, and one that failed
 * stays with its reason (scripts/queue.ts), so there is no "ready" toast.
 */
export function toastForEndedRun(run: RunRecord, ended: "finished" | "failed"): void {
  if (ended !== "failed" || document.documentElement.dataset.player !== "open") return;
  showToast({
    message:
      run.what === "briefing"
        ? (briefingFailureLine(run.step) ?? "The podcast couldn't be made.")
        : "The episode couldn't be made.",
    kind: "error",
  });
}
