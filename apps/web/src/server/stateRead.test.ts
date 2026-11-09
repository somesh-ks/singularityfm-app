import { describe, expect, it } from "vitest";
import { readStateFile, StateUnreadable } from "./stateRead";

const main = (text: string | null) => ({ readFile: async () => text });
const on = {
  DATABASE_URL: "postgres://x",
  SINGULARITY_STATE_STORE: "postgres",
  VERCEL: "1",
  VERCEL_ENV: "production",
};
const store = (rows: Record<string, unknown>[] | symbol) =>
  (async (_work: unknown, fallback: unknown) =>
    typeof rows === "symbol" ? fallback : rows) as never;

describe("reading a run-state file for the site (D381)", () => {
  // The bug it prevents: once the engine stops committing state/, main's last-run.json is frozen at
  // the last commit that carried it, so the cron would judge a daily "due" from a stale last run.
  it("takes the stored copy over main's, and null for a file the store lacks", async () => {
    expect(
      await readStateFile("state/last-run.json", main("frozen"), on, {
        database: store([{ content: "current" }]),
      }),
    ).toBe("current");
    expect(
      await readStateFile("state/last-run.json", main("frozen"), on, { database: store([]) }),
    ).toBeNull();
  });

  // The bug it prevents: a sleeping database answering with main's frozen copy and so starting a
  // second run, or none; the caller must stop instead.
  it("throws when the store is on and does not answer", async () => {
    await expect(
      readStateFile("state/last-run.json", main("frozen"), on, {
        database: store(Symbol.for("x")),
      }),
    ).rejects.toBeInstanceOf(StateUnreadable);
  });

  // The bug it prevents: a dev server holding the production URL in its environment waking Neon.
  it("reads main with the switch off, or off Vercel", async () => {
    const database = store([{ content: "current" }]);
    for (const env of [
      { ...on, SINGULARITY_STATE_STORE: undefined },
      { ...on, VERCEL: undefined },
      {},
    ]) {
      expect(await readStateFile("state/last-run.json", main("from main"), env, { database })).toBe(
        "from main",
      );
    }
  });
});
