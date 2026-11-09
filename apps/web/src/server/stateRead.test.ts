import { describe, expect, it } from "vitest";
import { readStateFile } from "./stateRead";

const github = (text: string | null) => ({ readFile: async () => text });
const store = (rows: Record<string, unknown>[] | Error) => ({
  query: async () => {
    if (rows instanceof Error) throw rows;
    return rows;
  },
});

describe("reading a run-state file for the site (D381)", () => {
  // The bug it prevents: once the engine stops committing state/, main's copy of last-run.json stops
  // moving, and the cron would read a record frozen at the last commit and start a run every hour.
  it("takes the stored copy over main's", async () => {
    const text = await readStateFile("state/last-run.json", github("from main"), {
      env: { DATABASE_URL: "postgres://x" },
      connect: () => store([{ content: "from the store" }]),
    });
    expect(text).toBe("from the store");
  });

  it("falls back to main with no database, no row, or a store that fails", async () => {
    const main = github("from main");
    expect(await readStateFile("state/last-run.json", main, { env: {} })).toBe("from main");
    const env = { DATABASE_URL: "postgres://x" };
    expect(
      await readStateFile("state/last-run.json", main, { env, connect: () => store([]) }),
    ).toBe("from main");
    expect(
      await readStateFile("state/last-run.json", main, {
        env,
        connect: () => store(new Error("relation state_documents does not exist")),
      }),
    ).toBe("from main");
  });
});
