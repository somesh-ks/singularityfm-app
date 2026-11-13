import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SeenFile } from "@singularityfm/core";
import {
  audioTimelineRelPath,
  type DigestId,
  type DigestKind,
  digestRelPath,
  MAX_REGENERATIONS,
  parseDigestFile,
} from "@singularityfm/core";
import { saveRunState } from "../git/commit.js";
import { readSeen, writeSeen } from "../state/store.js";
import { forgetPool } from "./carriedPool.js";
import { StageFailure } from "./errors.js";
import { type PlanPass, runCacheDir } from "./plan.js";
import type { DeleteReport, RunDeps, RunMode } from "./types.js";

/** The run mode a digest of this kind was made in, so a replacement is written the same way. */
const MODE_OF_KIND: Record<DigestKind, RunMode> = {
  regular: "scheduled",
  weekly: "weekly",
  "on-demand": "on-demand",
};

/** The pass that replaces digest `id`: its date, its kind and its id, over its own window to now. */
export async function replacementPass(
  deps: RunDeps,
  id: DigestId,
): Promise<{ pass: PlanPass; date: string; mode: RunMode; itemIds: string[] }> {
  let text: string;
  try {
    text = await readFile(join(deps.root, digestRelPath(id)), "utf8");
  } catch {
    throw new StageFailure(`--replace ${id}: there is no such digest`);
  }
  const old = parseDigestFile(text);
  return {
    pass: {
      id: old.id,
      kind: old.kind,
      window: { from: old.window.from, to: deps.now().toISOString() },
    },
    date: old.date,
    mode: MODE_OF_KIND[old.kind],
    itemIds: old.items.map((item) => item.id),
  };
}

/**
 * The regenerations a digest replacing `id` carries: the old count plus one (D212). A refused
 * fourth is the server's to stop; here the count is capped so a hand-run `--replace` still writes a
 * valid file.
 */
export async function nextRegenerations(root: string, id: DigestId): Promise<number> {
  const old = parseDigestFile(await readFile(join(root, digestRelPath(id)), "utf8"));
  return Math.min((old.regenerations ?? 0) + 1, MAX_REGENERATIONS);
}

/** The seen entries the gate released, kept for a failed run to put back. */
function releasedSeenPath(root: string): string {
  return join(runCacheDir(root), "released-seen.json");
}

/**
 * Lets the replaced digest's stories be picked again: the run is asked for the same window, and a
 * story already shown (state/seen.json) is skipped by the fetch. Only the working tree changes;
 * the commit stage writes the seen list of the new digest. The released entries are kept in the
 * run cache, so a failed run can put them back (`restoreReleasedSeen`).
 */
export async function releaseSeen(root: string, itemIds: readonly string[]): Promise<void> {
  const seen = await readSeen(root);
  const items = { ...seen.items };
  const released: SeenFile["items"] = {};
  for (const itemId of itemIds) {
    const entry = items[itemId];
    if (entry !== undefined) released[itemId] = entry;
    delete items[itemId];
  }
  // A repeated release finds the entries already gone: keep what the first one copied.
  const earlier = await readReleasedSeen(root);
  await mkdir(dirname(releasedSeenPath(root)), { recursive: true });
  await writeFile(releasedSeenPath(root), JSON.stringify({ ...earlier, ...released }), "utf8");
  await writeSeen(root, { ...seen, items });
}

/**
 * A failed Regenerate keeps its old digest, so the stories the gate released go back into the seen
 * list: left out, the next run would pick them again. A run that released nothing changes nothing.
 */
export async function restoreReleasedSeen(root: string): Promise<void> {
  const released = await readReleasedSeen(root);
  if (Object.keys(released).length === 0) return;
  const seen = await readSeen(root);
  await writeSeen(root, { ...seen, items: { ...seen.items, ...released } });
  // Used once: a later failed run must not put back what an earlier one released.
  await rm(releasedSeenPath(root), { force: true });
}

/** The copy of the released entries; none when the gate released nothing. Any other failure throws. */
async function readReleasedSeen(root: string): Promise<SeenFile["items"]> {
  try {
    return JSON.parse(await readFile(releasedSeenPath(root), "utf8")) as SeenFile["items"];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/**
 * Removes a digest's file and its narration timeline, and its kept pool (outside git, D376). The MP3
 * is overwritten by the next one of this id.
 */
export async function removeDigestFiles(root: string, id: DigestId): Promise<string[]> {
  const paths = [digestRelPath(id), audioTimelineRelPath(id)];
  for (const rel of paths) await rm(join(root, rel), { force: true });
  await forgetPool(root, id);
  return paths;
}

/** `singularity run --delete <id>`: removes the digest and its timeline, then saves the run state. */
export async function deleteDigest(
  deps: RunDeps,
  id: DigestId,
  options: { dryRun: boolean; noPush: boolean },
): Promise<DeleteReport> {
  try {
    await readFile(join(deps.root, digestRelPath(id)), "utf8");
  } catch {
    throw new StageFailure(`--delete ${id}: there is no such digest`);
  }
  if (options.dryRun) {
    return {
      outcome: "deleted",
      id,
      removed: [digestRelPath(id), audioTimelineRelPath(id)],
      dry_run: true,
      commit: "dry_run",
    };
  }
  const removed = await removeDigestFiles(deps.root, id);
  const outcome = await saveRunState({
    root: deps.root,
    command: "run",
    push: !options.noPush,
  });
  if (outcome.status === "save_failed") {
    throw new StageFailure(`Deleting ${id} did not complete: ${outcome.detail}`);
  }
  return { outcome: "deleted", id, removed, dry_run: false, commit: outcome.status };
}
