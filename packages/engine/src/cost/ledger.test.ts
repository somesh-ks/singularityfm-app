import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PriceTable } from "@singularityfm/core";
import { describe, expect, it } from "vitest";
import { RequestMeter } from "../llm/requestMeter.js";
import { callsFromSpend, loadAllCosts, recordPaidCalls, toRecord } from "./ledger.js";

const base = {
  at: "2026-10-20T05:13:00.000Z",
  runId: "2026-10-20T05:00:00.000Z",
  kind: "daily" as const,
  timezone: "Europe/Stockholm",
};

describe("cost ledger", () => {
  it("prices a run's measured tokens and requests, marking counted credits as estimated", () => {
    const calls = callsFromSpend(
      {
        requests: { jev: 40, exa: 3, firecrawl_listing: 10, firecrawl_scrape: 5, nebius: 7 },
        units: {
          "anthropic|claude-sonnet-5-5|input_tokens": 100_000,
          "anthropic|claude-sonnet-5-5|output_tokens": 20_000,
        },
      },
      base,
    );
    const byProvider = Object.fromEntries(calls.map((call) => [call.provider, call]));
    expect(byProvider.anthropic?.units).toEqual({ input_tokens: 100_000, output_tokens: 20_000 });
    expect(byProvider.anthropic?.estimated).toBeUndefined();
    expect(byProvider.firecrawl?.units).toEqual({ credits: 15 });
    expect(byProvider.firecrawl?.estimated).toBe(true);
    // Request counts of the token providers are not billed twice.
    expect(calls.some((call) => call.provider === "nebius")).toBe(false);
  });

  // The ledger booked a whole prompt as plain input, so a cache write (1.25x) was undercounted
  // and a cache read (0.1x) overcounted, and the hit rate could not be seen at all.
  it("prices a cache write above and a cache read below a plain input token", () => {
    const meter = new RequestMeter();
    // inputTokens is the whole prompt: 100 uncached, 1,000 written to cache, 2,000 read from it.
    meter.addTokens("anthropic", "claude-sonnet-5-5", {
      inputTokens: 3_100,
      outputTokens: 0,
      cacheWriteTokens: 1_000,
      cacheReadTokens: 2_000,
    });
    const units = meter.peekUnits();
    expect(units["anthropic|claude-sonnet-5-5|input_tokens"]).toBe(100);
    expect(units["anthropic|claude-sonnet-5-5|cache_write_input_tokens"]).toBe(1_000);
    expect(units["anthropic|claude-sonnet-5-5|cache_read_input_tokens"]).toBe(2_000);
    const [call] = callsFromSpend({ requests: {}, units }, base);
    const per = (usd: number) => ({ usd, per: 1_000_000 });
    const table = PriceTable.parse({
      version: 1,
      as_of: "2026-11-14",
      prices: [
        {
          provider: "anthropic",
          product: "claude-sonnet-5-5",
          units: {
            input_tokens: per(2),
            cache_write_input_tokens: per(2.5),
            cache_read_input_tokens: per(0.1),
          },
          as_of: "2026-11-14",
          confirmed: false,
          note: "a frozen table",
        },
      ],
    });
    const record = toRecord(table, call as NonNullable<typeof call>);
    // 100 x 2 + 1,000 x 2.5 + 2,000 x 0.1 USD per million tokens.
    expect(record.usd).toBeCloseTo(0.0029, 6);
    expect(record.unpriced).toBeUndefined();
  });

  it("keeps one record per run and product when the commit stage is run again", async () => {
    const root = await mkdtemp(join(tmpdir(), "costs-"));
    const prices = {
      version: 1 as const,
      as_of: "2026-10-21",
      prices: [
        {
          provider: "speechify",
          product: "*",
          units: { characters: { usd: 10, per: 1_000_000 } },
          as_of: "2026-10-21",
          confirmed: false,
        },
      ],
    };
    const call = {
      ...base,
      stage: "narration",
      provider: "speechify",
      product: "simba-3.2",
      units: { characters: 50_000 },
    };
    await recordPaidCalls(root, [call], prices);
    await recordPaidCalls(root, [call], prices);
    const all = await loadAllCosts(root);
    expect(all).toHaveLength(1);
    expect(all[0]?.usd).toBeCloseTo(0.5, 10);
    expect(
      JSON.parse(await readFile(join(root, "state", "costs-2026-10.json"), "utf8")).version,
    ).toBe(1);
  });
});
