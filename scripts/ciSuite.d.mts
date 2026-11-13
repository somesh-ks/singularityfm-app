export interface ShardReport {
  failed: { where: string; error: string }[];
  flaky: { where: string }[];
  errors: string[];
  passed: number;
  seconds: number;
}
export type Verdict = { kind: "pass" | "flaky" | "code" | "infra" | "unknown"; signature?: string };
/** Playwright's JSON report as lists a person reads, or null when the text is not a report. */
export declare function readReport(text: string): ShardReport | null;
/** What a run was: `infra` is the only red kind worth running again. */
export declare function classify(run: {
  code: number;
  report: ShardReport | null;
  log: string;
}): Verdict;
export declare function render(
  label: string,
  attempts: (Verdict & { report: ShardReport | null })[],
): string;
/** The summed `stats` block the daily health check reads. */
export declare function mergeStats(reports: { stats?: Record<string, number> }[]): {
  stats: { expected: number; unexpected: number; flaky: number; skipped: number };
};
