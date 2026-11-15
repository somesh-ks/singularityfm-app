import { PriceTable } from "@singularityfm/core";
import { describe, expect, it } from "vitest";
import { callsFromSpend, toRecord } from "../cost/ledger.js";
import { RequestMeter } from "./requestMeter.js";

const base = {
  at: "2026-10-20T05:13:00.000Z",
  runId: "2026-10-20T05:00:00.000Z",
  kind: "daily" as const,
  timezone: "Europe/Stockholm",
};

describe("request meter", () => {
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
});
