import { describe, expect, it } from "vitest";
import { saveRunState } from "../src/git/commit.js";

// The bug it prevents: with state/ and the content out of git (D300), every run leaves git nothing
// to commit; returning at that point skipped the only place the run state is saved, so the next run
// started from the old seen list and published the same stories again. The root does not exist: the
// save must not need a git repository.
describe("saveRunState", () => {
  it("saves the state and says so, and fails the commit when the save fails", async () => {
    const calls: string[] = [];
    const saveState = async (_root: string, command: string): Promise<string[]> => {
      calls.push(command);
      return ["state/seen.json"];
    };
    const base = { root: "/nowhere", command: "run", push: true } as const;
    expect(await saveRunState({ ...base, saveState })).toEqual({
      status: "saved",
      paths: ["state/seen.json"],
    });
    expect(calls).toEqual(["run"]);
    expect(await saveRunState({ ...base, saveState: async () => [] })).toEqual({
      status: "nothing_to_commit",
    });
    const failed = await saveRunState({
      ...base,
      saveState: async () => {
        throw new Error("the store is down");
      },
    });
    expect(failed).toMatchObject({ status: "save_failed" });
    // A local run never touches the store.
    await saveRunState({ ...base, push: false, saveState });
    expect(calls).toEqual(["run"]);
  });
});
