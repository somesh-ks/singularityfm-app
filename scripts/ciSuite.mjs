// Runs one shard of a browser suite (browser.yml) and tells a failure that running again can fix from
// one it cannot. A blind retry hides a real regression and a blind "fix the code" chases a dead runner,
// so the first read of a red shard is by cause (docs/engineering/delivery-failures.md, rule 4):
//   code     a test failed (the site suite retries each once itself): the code or the test is wrong. No rerun.
//   infra    the run never reached the tests (the server did not start, the runner killed the process,
//            a network reset) or every failure is the server gone: rerun the shard once, say so.
//   flaky    green, but a test passed only on its retry: reported by name, never a failure (D360).
//   unknown  no report, or red with no failed test and no known infra signature: read the log, no rerun.
// The result goes to the job page ($GITHUB_STEP_SUMMARY) and to annotations on the run.
// Usage in CI: node scripts/ciSuite.mjs run "<label>" <report.json> -- <command...>
//              node scripts/ciSuite.mjs merge <dir of shard reports> <merged.json> <shard count>
import { spawn } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

// What a runner or the network does to a run that has nothing to do with the code. Kept short and
// literal: a signature added here makes a failure rerun once, so each needs a log that showed it.
const INFRA = [
  /Timed out waiting \d+ms from config\.webServer/,
  /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOSPC)\b/,
  /socket hang up/i,
  /killed by SIG(?:KILL|TERM)/,
];
// A test failing because the static server died under it, not because the page was wrong.
const SERVER_GONE = /ERR_CONNECTION_(?:REFUSED|RESET)|ECONNREFUSED/;

const clean = (text) => stripVTControlCharacters(String(text ?? ""));
const firstLine = (text) =>
  clean(text)
    .split("\n")
    .find((line) => line.trim()) ?? "";

function* specsOf(suites, file) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) yield { ...spec, file: spec.file ?? suite.file ?? file };
    yield* specsOf(suite.suites, suite.file ?? file);
  }
}

/** Playwright's JSON report as the lists a person reads, or null when the text is not a report. */
export function readReport(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const failed = [];
  const flaky = [];
  for (const spec of specsOf(json.suites)) {
    for (const test of spec.tests ?? []) {
      const where = `${spec.file}:${spec.line} [${test.projectName}] ${spec.title}`;
      if (test.status === "flaky") flaky.push({ where });
      if (test.status === "unexpected") {
        const last = test.results?.at(-1);
        failed.push({
          where,
          error: firstLine(last?.error?.message ?? last?.errors?.[0]?.message),
        });
      }
    }
  }
  const stats = json.stats ?? {};
  return {
    failed,
    flaky,
    errors: (json.errors ?? []).map((each) => clean(each.message)),
    passed: Number(stats.expected) || 0,
    seconds: Math.round((Number(stats.duration) || 0) / 1000),
  };
}

/** Which kind of run this was; see the top of the file. `report` is readReport's result or null. */
export function classify({ code, report, log }) {
  // A green exit with no report is a reporter that wrote nothing: the shard's counts are lost.
  if (code === 0)
    return report ? { kind: report.flaky.length ? "flaky" : "pass" } : { kind: "unknown" };
  if (report?.failed.length) {
    return report.failed.every((each) => SERVER_GONE.test(each.error))
      ? { kind: "infra", signature: "the server went away under the tests" }
      : { kind: "code" };
  }
  const text = [log, ...(report?.errors ?? [])].map(clean).join("\n");
  for (const signature of INFRA) {
    const found = signature.exec(text);
    if (found) return { kind: "infra", signature: found[0] };
  }
  return { kind: "unknown" };
}

const NEXT = {
  code: "A test failed (the site suite already retried it once), so the code or the test is wrong; running it again would not help. Fix it; the trace is on the run.",
  infra: "The run died before the tests could judge the code.",
  unknown:
    "Red with no failed test and no known runner fault. Read the log of this job; nothing was rerun.",
};

/** The job-page text for a shard: every attempt, then what to do. */
export function render(label, attempts) {
  const lines = [`### ${label}`, ""];
  attempts.forEach(({ kind, signature, report }, index) => {
    const n = attempts.length > 1 ? `attempt ${index + 1}: ` : "";
    const counts = report
      ? `${report.passed} passed, ${report.flaky.length} flaky, ${report.failed.length} failed, ${report.seconds} s`
      : "no report";
    lines.push(`- ${n}**${kind}**${signature ? ` (${signature})` : ""}: ${counts}`);
  });
  const last = attempts.at(-1);
  if (NEXT[last.kind]) lines.push("", NEXT[last.kind]);
  for (const each of last.report?.failed ?? [])
    lines.push(`- failed: \`${each.where}\`: ${each.error}`);
  const flaky = attempts.flatMap(({ report }) => report?.flaky ?? []);
  if (flaky.length) {
    lines.push(
      "",
      "Passed only on retry. The same name twice in a week is a bug to fix, not a flake to live with:",
    );
    for (const each of flaky) lines.push(`- flaky: \`${each.where}\``);
  }
  return `${lines.join("\n")}\n`;
}

/** Sums shard reports into the one `stats` block the daily health check reads (D360). */
export function mergeStats(reports) {
  const total = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  for (const { stats } of reports) {
    for (const key of Object.keys(total)) total[key] += Number(stats?.[key]) || 0;
  }
  return { stats: total };
}

const inline = (text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const write = (text) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  else console.log(text);
};

function run(command, args, reportFile) {
  rmSync(reportFile, { force: true });
  return new Promise((done) => {
    let log = "";
    const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
    for (const [from, to] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      from.setEncoding("utf8");
      from.on("data", (chunk) => {
        to.write(chunk);
        log = (log + chunk).slice(-20_000);
      });
    }
    child.on("error", (error) => done({ code: 1, log: `${log}\n${error.message}` }));
    child.on("close", (code, signal) =>
      done({ code: code ?? 1, log: signal ? `${log}\nkilled by ${signal}` : log }),
    );
  });
}

async function runShard(label, reportFile, [command, ...args]) {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { code, log } = await run(command, args, reportFile);
    let report = null;
    try {
      report = readReport(readFileSync(reportFile, "utf8"));
    } catch {}
    const verdict = { ...classify({ code, report, log }), report };
    attempts.push(verdict);
    if (verdict.kind !== "infra" || attempt === 2) break;
    console.log(
      `::warning title=${label}::${inline(`infra fault (${verdict.signature}); rerunning the shard once`)}`,
    );
  }
  const last = attempts.at(-1);
  write(render(label, attempts));
  for (const each of last.report?.failed ?? [])
    console.log(`::error title=${label}::${inline(`${each.where}: ${each.error}`)}`);
  for (const each of attempts.flatMap(({ report }) => report?.flaky ?? [])) {
    console.log(`::warning title=${label} flaky::${inline(each.where)}`);
  }
  return last.kind === "pass" || last.kind === "flaky" ? 0 : 1;
}

function reportsIn(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      found.push(JSON.parse(readFileSync(join(entry.parentPath, entry.name), "utf8")));
    } catch {}
  }
  return found;
}

function mergeShards(dir, out, expected) {
  let reports = [];
  try {
    reports = reportsIn(dir);
  } catch {}
  // A shard that died writes no report; summing the others would hand the health check a count that
  // looks complete. Writing nothing leaves it the last complete run's.
  if (reports.length !== expected) {
    console.log(
      `::warning::${reports.length} of ${expected} site reports; the week's flaky count skips this run`,
    );
    return;
  }
  mkdirSync(dirname(out), { recursive: true });
  const merged = mergeStats(reports);
  writeFileSync(out, JSON.stringify(merged));
  const { expected: passed, unexpected, flaky } = merged.stats;
  write(
    `### site suite, all shards\n\n${reports.length} reports: ${passed} passed, ${flaky} flaky, ${unexpected} failed\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , mode, ...rest] = process.argv;
  if (mode === "run" && rest[2] === "--") {
    process.exit(await runShard(rest[0], rest[1], rest.slice(3)));
  } else if (mode === "merge" && rest.length === 3) {
    mergeShards(rest[0], rest[1], Number(rest[2]));
  } else {
    console.error(
      'usage: ciSuite.mjs run "<label>" <report.json> -- <command...> | merge <dir> <out.json> <shards>',
    );
    process.exit(2);
  }
}
