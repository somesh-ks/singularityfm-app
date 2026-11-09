import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Locator, type Page } from "@playwright/test";

/**
 * Every test fails if its page logs an error or throws. The admin's pages draw from the reader's
 * /api/costs and /api/health and from this app's /api/stages: each gets a frozen answer here.
 * Moved from the reader's suite (D382 step 4), so the admin repository carries its own.
 */
export interface Problems {
  messages: string[];
}

interface Options {
  /** Set for a test that fails a request on purpose, where failed requests are expected. */
  allowNetworkErrors: boolean;
}

export const test = base.extend<Options & { problems: Problems }>({
  allowNetworkErrors: [false, { option: true }],
  problems: [
    async ({ page, allowNetworkErrors }, use) => {
      const problems: Problems = { messages: [] };
      // The page's own reports (client errors and CSP violations) go to /api/report, which the
      // static server does not have; the API takes them with 204.
      await page.route("**/api/report", (route) => route.fulfill({ status: 204 }));
      // The Costs page draws from /api/costs: a frozen report, split by the breakdown it asks for.
      await page.route("**/api/costs**", (route) =>
        route.fulfill({
          json: costsReport(new URL(route.request().url()).searchParams.get("by") ?? "provider"),
        }),
      );
      // The Health page draws from /api/health: a frozen answer with a reading of every tone.
      await page.route("**/api/health", (route) => route.fulfill({ json: healthReport() }));
      // Its Stage times card draws from the admin function: a frozen answer of two kinds of run.
      await page.route("**/api/stages", (route) => route.fulfill({ json: stageTimings() }));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        const isNetworkNoise =
          /Failed to load resource|net::ERR|Failed to fetch|Error hydrating/.test(text);
        if (allowNetworkErrors && isNetworkNoise) return;
        problems.messages.push(`console: ${text} ${message.location().url}`);
      });
      page.on("pageerror", (error) => problems.messages.push(`pageerror: ${error.message}`));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const holder = window as unknown as { __csp?: string[] };
          holder.__csp = holder.__csp ?? [];
          holder.__csp.push(`${event.violatedDirective} blocked ${event.blockedURI}`);
        });
      });
      await use(problems);
      const violations = await page
        .evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])
        .catch(() => []);
      expect([...problems.messages, ...violations.map((v) => `csp: ${v}`)]).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** The admin's pages that the sweeps in pages.spec.ts cover. */
export const ADMIN_PAGES = ["/admin/costs", "/admin/health", "/admin/coverage"];

/** A frozen /api/stages answer: a daily run's stages out of pipeline order and a Catch up's. */
export function stageTimings() {
  const row = (workflow: string, kind: string, stage: string, p50_ms: number, p90_ms: number) => ({
    workflow,
    kind,
    stage,
    runs: 6,
    p50_ms,
    p90_ms,
  });
  return {
    days: 14,
    timings: [
      row("run", "daily", "write", 96_000, 141_000),
      row("run", "daily", "fetch", 41_000, 66_000),
      row("podcast", "catch_up", "script", 74_000, 98_000),
    ],
  };
}

/** A frozen /api/health answer: a row of each tone, and both devices' speed. */
export function healthReport() {
  const row = (id: string, value: string, detail: string, tone: string) => ({
    id,
    value,
    detail,
    tone,
  });
  return {
    checked_at: "2026-10-22T10:00:00.000Z",
    attention: { count: 2, tone: "bad" },
    tiles: {
      last_briefing: "5 h ago",
      briefing_time: "3.4 min",
      page_load: "1.8 s",
      errors_today: "0",
    },
    rows: [
      row("daily", "5 h ago", "8 stories", "good"),
      row("weekly", "2 d ago", "The last run failed", "bad"),
      row("catch_up", "Never", "No episode made yet", "none"),
      row("narration", "4.6 min", "92% of its 5 min", "good"),
      row("fallbacks", "1", "In the last run", "warn"),
      row("time_daily", "3.4 min", "Last 3.6 min, median of 6 runs", "none"),
      row("time_weekly", "5.3 min", "Last 5.0 min, median of 2 runs", "none"),
      row("lcp.mobile", "1.8 s", "Good, 212 visits", "good"),
      row("inp.mobile", "96 ms", "Good, 180 visits", "good"),
      row("cls.mobile", "0.02", "Good, 212 visits", "good"),
      row("lcp.desktop", "1.1 s", "Too few to judge, 4 visits", "none"),
      row("inp.desktop", "No data", "No visits measured this week", "none"),
      row("cls.desktop", "0.00", "Too few to judge, 4 visits", "none"),
      row("page_errors", "0", "None this week", "good"),
      row("blocked_scripts", "0", "2 this week, most on /", "good"),
      row("server_errors", "0", "None this week", "good"),
      row("timeouts", "0", "None this week", "good"),
      row("job_run", "All passed", "9 runs this week, last 5 h ago", "good"),
      row("job_podcast", "All passed", "3 runs this week, last 1 d ago", "good"),
      row("job_audio", "All passed", "6 runs this week, last 5 h ago", "good"),
      row("job_content", "All passed", "14 runs this week, last 5 h ago", "good"),
      row("job_health", "All passed", "7 runs this week, last 2 h ago", "good"),
      row("sources", "All fetching", "176 fetched this week", "good"),
      row("database", "Answering", "Field data and reports", "good"),
      row("content", "Answering", "Pages read it live", "good"),
    ],
    parts: { content: "ok", database: "ok", github: "ok" },
  };
}

/**
 * A frozen /api/costs report: two days, two providers on the first, split by the breakdown asked
 * for (`by`), so a split by use loses the providers as the real one does.
 */
export function costsReport(by: string) {
  const day = (date: string, usd: number, split: Record<string, number>) => ({
    bucket: date,
    total: { usd, runs: 1, shared_usd: 0 },
    groups: Object.fromEntries(
      Object.entries(split).map(([key, value]) => [key, { usd: value, runs: 1, shared_usd: 0 }]),
    ),
  });
  const byProvider = by === "provider";
  return {
    time_zone: "Europe/Stockholm",
    prices_as_of: "2026-10-01",
    unconfirmed: ["speechify/*"],
    site: "ok",
    report: {
      buckets: [
        day("2026-10-18", 0.6, byProvider ? { anthropic: 0.4, speechify: 0.2 } : { daily: 0.6 }),
        day("2026-10-20", 0.3, byProvider ? { speechify: 0.3 } : { narration_on_play: 0.3 }),
      ],
      total: { usd: 0.9, runs: 2, shared_usd: 0 },
      per_run_usd: 0.45,
      per_user_usd: 0.9,
      users: 1,
    },
  };
}

/**
 * How far a control answers a pointer around its centre, in CSS pixels. A chip is 36px tall and
 * extends its target to 44px with a pseudo-element, which a bounding box does not show; hit testing
 * does. Scrolls the control to the middle of the screen first, clear of the sticky bars.
 */
export async function targetSize(control: Locator): Promise<{ width: number; height: number }> {
  return control.evaluate((node) => {
    node.scrollIntoView({ block: "center", inline: "center" });
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hits = (dx: number, dy: number): boolean => {
      const found = document.elementFromPoint(x + dx, y + dy);
      return found !== null && (found === node || node.contains(found));
    };
    const reach = (dx: number, dy: number): number => {
      let distance = 0;
      while (distance < 60 && hits(dx * (distance + 1), dy * (distance + 1))) distance += 1;
      return distance;
    };
    return { width: reach(-1, 0) + reach(1, 0) + 1, height: reach(0, -1) + reach(0, 1) + 1 };
  });
}

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Axe's WCAG 2.2 AA violations on the page as it is now, one line each. */
export async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
}

/**
 * Scans the page as it stands in the light scheme, then in the dark one, so one set-up covers both.
 * Colours change over a transition, so each scan waits for the finite animations to end first.
 */
export async function expectNoViolationsInEitherScheme(page: Page): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const finite = document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getComputedTiming().endTime !== Infinity,
        );
      // A second at most: an animation that never ends is not waited for.
      await Promise.race([
        Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    });
    expect(await violations(page), `${scheme} scheme`).toEqual([]);
  }
}
