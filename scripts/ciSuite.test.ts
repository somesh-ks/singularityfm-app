import { describe, expect, it } from "vitest";
import { classify, mergeStats, readReport } from "./ciSuite.mjs";

// 2026-11-13: a slow runner pushed the site suite past its job timeout and the red read like a code
// failure; the other way round, rerunning a failed assertion would hide a regression. The class of a
// red shard decides whether it runs again.
const report = (tests: { status: string; error?: string }[]) =>
  JSON.stringify({
    suites: [
      {
        file: "a.spec.ts",
        specs: tests.map((test, index) => ({
          title: `t${index}`,
          file: "a.spec.ts",
          line: index + 1,
          tests: [
            {
              status: test.status,
              projectName: "phone",
              results: [{ error: test.error ? { message: test.error } : undefined }],
            },
          ],
        })),
      },
    ],
    stats: { expected: 1, flaky: 1, unexpected: 0, skipped: 0, duration: 4000 },
  });

describe("ciSuite", () => {
  it("reruns only a run that never judged the code, never a failed assertion", () => {
    const assertion = readReport(
      report([{ status: "unexpected", error: "\u001b[31mExpected: 1\u001b[39m" }]),
    );
    expect(assertion?.failed[0]?.error).toBe("Expected: 1");
    expect(classify({ code: 1, report: assertion, log: "ECONNRESET" }).kind).toBe("code");

    expect(
      classify({
        code: 1,
        report: null,
        log: "Error: Timed out waiting 240000ms from config.webServer",
      }),
    ).toMatchObject({ kind: "infra" });
    expect(classify({ code: 1, report: null, log: "killed by SIGKILL" }).kind).toBe("infra");
    expect(classify({ code: 0, report: null, log: "" }).kind).toBe("unknown");
    expect(
      classify({ code: 1, report: null, log: "SyntaxError in playwright.config.ts" }).kind,
    ).toBe("unknown");

    const dead = readReport(
      report([{ status: "unexpected", error: "page.goto: net::ERR_CONNECTION_REFUSED" }]),
    );
    expect(classify({ code: 1, report: dead, log: "" }).kind).toBe("infra");
  });

  it("names a test that passed only on its retry, and sums shards for the health check", () => {
    const flaky = readReport(report([{ status: "flaky" }]));
    expect(flaky?.flaky[0]?.where).toBe("a.spec.ts:1 [phone] t0");
    expect(classify({ code: 0, report: flaky, log: "" }).kind).toBe("flaky");
    expect(
      mergeStats([{ stats: { expected: 5, flaky: 1 } }, { stats: { expected: 7, unexpected: 2 } }]),
    ).toEqual({
      stats: { expected: 12, unexpected: 2, flaky: 1, skipped: 0 },
    });
  });
});
