const ANSI_ESCAPE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const DIAGNOSTIC_LINE =
  /^(?:::)?(?:warning|warn|error|fail(?:ed|ure)?)(?::|\b)|^\[(?:kumiko|api|security|channel-email|user-profile|runProdApp|composeFeatures|check-security|runtime-isolation|tailwind-[^\]]+ WARN)/i;
const ACTIONABLE_MESSAGE =
  /^(?:An update to .* not wrapped in act|No baseline found|.*(?:plaintext|couldn't|does not exist|no persistent|not registered|will not render|PII ciphertext|already auto-mounted|skipped:|not found))/i;

export function isCI(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env["CI"] === "true";
}

export type OutputDiagnostics = {
  readonly lines: readonly string[];
  readonly total: number;
};

export function findOutputDiagnostics(output: string, limit = 6): OutputDiagnostics {
  const unique = new Set<string>();
  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(ANSI_ESCAPE, "").trim();
    if (/^\(?pass\)?\b/i.test(line)) continue;
    if (/^(?:\d+ (?:pass|fail|skip)|Ran \d+ tests?|(?:Files|Dirs|Tests):)/i.test(line)) continue;
    // [runProdApp] is used for routine boot progress as well as real
    // warnings/aborts — exclude the known-benign progress phrasing only.
    if (/^\[runProdApp\]\s*(?:booting\b|boot validation OK\b|checking schema drift\b|.*received — draining|graceful shutdown complete\b|ready on\b)/i.test(line)) continue;
    if (line.length === 0 || (!DIAGNOSTIC_LINE.test(line) && !ACTIONABLE_MESSAGE.test(line))) {
      continue;
    }
    unique.add(line.replace(/\s+/g, " "));
  }

  const lines = [...unique];
  return { lines: lines.slice(0, limit), total: lines.length };
}

export function formatCompactSuccess(label: string, output: string): string {
  const summary = formatIntegrationSummary(output) ?? formatBunTestSummary(output);
  const diagnostics = findOutputDiagnostics(output);
  const suffix = summary ?? "completed";
  const lines = [`  ✓ ${label} — ${suffix}`];

  if (diagnostics.total > 0) {
    lines.push(
      `    diagnostics: ${diagnostics.total} unique warning/error line(s) emitted (non-gating)`,
    );
    for (const line of diagnostics.lines) lines.push(`      ${line}`);
    if (diagnostics.total > diagnostics.lines.length) {
      lines.push(`      … ${diagnostics.total - diagnostics.lines.length} more`);
    }
  }

  return `${lines.join("\n")}\n`;
}

const MAX_FAILURE_LINES = 200;

export function formatCompactFailure(label: string, code: number, output: string): string {
  // Content lines are never dropped or dedup'd — a dedup here would silently
  // drop real, repeated diff lines (e.g. nested closing braces in a toEqual
  // diff). Blank lines are stripped. Capped (head+tail, not dedup'd) so one
  // runaway step can't blow up the log.
  const lines = output
    .split("\n")
    .map((rawLine) => rawLine.replace(ANSI_ESCAPE, "").trimEnd())
    .filter((line) => line.length > 0);
  const header = `  ✗ ${label} (exit ${code}; ${lines.length} line(s))`;
  const body = capLines(lines, MAX_FAILURE_LINES);
  return `${header}\n${body.map((line) => `    ${line}`).join("\n")}\n`;
}

function capLines(lines: readonly string[], max: number): readonly string[] {
  if (lines.length <= max) return lines;
  const half = Math.floor(max / 2);
  const omitted = lines.length - max;
  return [
    ...lines.slice(0, half),
    `… ${omitted} line(s) omitted (full log in the job's raw output) …`,
    ...lines.slice(lines.length - half),
  ];
}

function formatIntegrationSummary(output: string): string | undefined {
  const match = output.match(
    /Integration(?: perf)? summary[\s\S]*?Files:\s*(\d+)\/(\d+) executed[\s\S]*?Tests:\s*(\d+) pass,\s*(\d+) fail\s*\((\d+) total\)/,
  );
  if (match === null) return undefined;

  return `${match[3]} pass, ${match[4]} fail (${match[5]} tests across ${match[1]}/${match[2]} files)`;
}

export function formatBunTestSummary(output: string): string | undefined {
  const ranMatches = [...output.matchAll(/Ran (\d+) tests? across (\d+) files?\./g)];
  const lastRan = ranMatches.at(-1);
  if (!lastRan) return undefined;

  const idx = output.lastIndexOf(lastRan[0]);
  // Counts precede the "Ran N tests" line; take the occurrence closest to
  // it so an earlier, unrelated test block in the same output can't be picked up.
  const head = output.slice(Math.max(0, idx - 500), idx);
  const pass = lastMatchCount(head, /(\d+) pass/g);
  const fail = lastMatchCount(head, /(\d+) fail/g);
  const skip = lastMatchCount(head, /(\d+) skip/g);
  const tests = Number(lastRan[1]);
  const files = Number(lastRan[2]);
  const duration = output.slice(idx).match(/\[([^\]\n]+)\]/)?.[1];
  const durationSuffix = duration === undefined ? "" : `, ${duration}`;

  return `${pass} pass, ${fail} fail${skip === 0 ? "" : `, ${skip} skip`} (${tests} tests across ${files} files${durationSuffix})`;
}

function lastMatchCount(input: string, pattern: RegExp): number {
  const matches = [...input.matchAll(pattern)];
  const last = matches.at(-1);
  return last === undefined ? 0 : Number(last[1]);
}
