/**
 * Parse and evaluate `bun audit --json` reports with exception support.
 */
import { isExceptionValid, matchesPackageName } from "./dependency-exceptions";

export type Severity = "critical" | "high" | "moderate" | "low" | "info";

export type RawAuditEntry = {
  readonly id?: number;
  readonly url?: string;
  readonly title?: string;
  readonly severity?: string;
  readonly vulnerable_versions?: string;
};

export type RawAuditReport = Record<string, readonly RawAuditEntry[]>;

export type AuditAdvisory = {
  readonly package: string;
  readonly severity: Severity;
  readonly advisoryId: string;
  readonly url: string;
  readonly title: string;
};

export type SecurityException = {
  readonly advisory: string;
  readonly package: string;
  readonly reason: string;
  readonly reviewedBy: string;
  readonly expires: string;
};

export type SecurityEvaluation = {
  readonly blocking: AuditAdvisory[];
  readonly warnings: AuditAdvisory[];
  readonly suppressed: AuditAdvisory[];
  readonly counts: Record<Severity, number>;
};

const FAIL_SEVERITIES = new Set<Severity>(["critical", "high"]);

export function parseAuditReport(raw: RawAuditReport): AuditAdvisory[] {
  const advisories: AuditAdvisory[] = [];
  for (const [pkg, entries] of Object.entries(raw)) {
    for (const entry of entries) {
      const severity = normalizeSeverity(entry.severity);
      if (!severity) continue;
      advisories.push({
        package: pkg,
        severity,
        advisoryId: resolveAdvisoryId(entry),
        url: entry.url ?? "",
        title: entry.title ?? "",
      });
    }
  }
  return advisories;
}

function normalizeSeverity(raw: string | undefined): Severity | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (
    lower === "critical" ||
    lower === "high" ||
    lower === "moderate" ||
    lower === "low" ||
    lower === "info"
  ) {
    return lower;
  }
  return null;
}

function resolveAdvisoryId(entry: RawAuditEntry): string {
  if (entry.url) {
    const ghsa = entry.url.match(/GHSA-[a-z0-9-]+/i);
    if (ghsa) return ghsa[0].toUpperCase();
  }
  if (entry.id !== undefined) return String(entry.id);
  return "unknown";
}

function matchesAdvisory(exceptionAdvisory: string, advisoryId: string, url: string): boolean {
  if (exceptionAdvisory.trim().toUpperCase() === advisoryId.toUpperCase()) return true;
  return url.includes(exceptionAdvisory);
}

function findSecurityException(
  advisory: AuditAdvisory,
  exceptions: readonly SecurityException[],
): SecurityException | undefined {
  return exceptions.find(
    (ex) =>
      matchesAdvisory(ex.advisory, advisory.advisoryId, advisory.url) &&
      (ex.package === "*" || matchesPackageName(ex.package, advisory.package)),
  );
}

export function evaluateSecurity(
  advisories: readonly AuditAdvisory[],
  exceptions: readonly SecurityException[],
  nowMs: number = Date.now(),
): SecurityEvaluation {
  const counts: Record<Severity, number> = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  const blocking: AuditAdvisory[] = [];
  const warnings: AuditAdvisory[] = [];
  const suppressed: AuditAdvisory[] = [];

  for (const advisory of advisories) {
    counts[advisory.severity] += 1;
    const exception = findSecurityException(advisory, exceptions);
    // isExceptionValid() treats a missing expiry as "forever valid", which is wrong for security: such an exception would suppress a critical permanently.
    const covered =
      exception !== undefined &&
      Boolean(exception.expires) &&
      isExceptionValid(exception.expires, nowMs).valid;

    if (covered) {
      suppressed.push(advisory);
    } else if (FAIL_SEVERITIES.has(advisory.severity)) {
      blocking.push(advisory);
    } else if (advisory.severity === "moderate") {
      warnings.push(advisory);
    }
  }

  return { blocking, warnings, suppressed, counts };
}

/** True when `bytes` starts with the gzip magic header (1f 8b). */
export function isGzipPayload(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

// Built from char code 27 (ESC) so the control character never appears in a regex literal.
const CSI_SEQUENCE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`, "g");

/** Strip CSI escape sequences — some bun builds color `--json` under CI, and
 * some CI runners also emit cursor/line-clear CSI codes (\x1b[2K, \x1b[?25l)
 * on the same pipe; either survives a color-only (SGR) regex and breaks
 * JSON.parse the same way raw color codes did. */
export function stripAnsi(text: string): string {
  return text.replace(CSI_SEQUENCE, "");
}

/** Decode bun audit stdout/stderr — some CI runners get gzip bytes on the pipe. */
export function decodeBunAuditPayload(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  // Always copy first — Bun.gunzipSync typings reject SharedArrayBuffer views,
  // and a fresh Uint8Array also makes the gzip magic check reliable on CI.
  const copy = Uint8Array.from(bytes);
  const body = isGzipPayload(copy) ? Bun.gunzipSync(copy) : copy;
  return stripLeadingNonJson(stripAnsi(new TextDecoder().decode(body)).trim());
}

/** Bun may print `bun audit vX` banner on the same stream as `--json` body.
 *  No `{` at all means there IS no body — the advisory fetch failed and only
 *  the banner arrived. Returning the raw text there sent the banner into
 *  JSON.parse and surfaced a network outage as `Unexpected identifier "bun"`
 * . Empty string lets the caller skip the stream instead. */
export function stripLeadingNonJson(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) return "";
  return text.slice(start);
}

/** Verbatim head of a stream, for the "no JSON anywhere" diagnostic. */
function streamHead(bytes: Uint8Array): string {
  if (bytes.length === 0) return "(empty)";
  const copy = Uint8Array.from(bytes);
  const body = isGzipPayload(copy) ? Bun.gunzipSync(copy) : copy;
  return stripAnsi(new TextDecoder().decode(body)).trim().slice(0, 200) || "(empty)";
}

export class BunAuditUnavailableError extends Error {
  constructor(
    stdoutBytes: Uint8Array,
    stderrBytes: Uint8Array,
    exitCode?: number,
    // Set only when *we* killed the process for running past its timeout —
    // that is a self-inflicted abort, not evidence of a network/registry outage.
    killedAfterTimeoutMs?: number,
  ) {
    const reason =
      killedAfterTimeoutMs === undefined
        ? "the advisory fetch likely failed (network/registry)"
        : `bun audit was killed after exceeding its ${killedAfterTimeoutMs}ms timeout`;
    super(
      `bun audit produced no JSON body on either stream — ${reason}. This is not a vulnerability finding.` +
        (exitCode === undefined ? "" : ` (exit ${exitCode})`) +
        `\n  stdout: ${streamHead(stdoutBytes)}\n  stderr: ${streamHead(stderrBytes)}`,
    );
    this.name = "BunAuditUnavailableError";
  }
}

function isAuditEntry(value: unknown): value is RawAuditEntry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuditReport(value: unknown): value is RawAuditReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entries) => Array.isArray(entries) && entries.every(isAuditEntry),
  );
}

/**
 * Pick the first stdout/stderr decode that JSON.parse accepts as an object.
 * Bun may put gzip JSON on one stream and a text warning on the other —
 * preferring `stdout || stderr` then failed when stdout was non-empty garbage.
 */
export function parseBunAuditStreams(
  stdoutBytes: Uint8Array,
  stderrBytes: Uint8Array,
  exitCode?: number,
): RawAuditReport {
  // Decode inside the loop — corrupt gzip on one stream must not kill the other
  // before we try JSON.parse.
  const errors: string[] = [];
  let tried = 0;
  for (const raw of [stdoutBytes, stderrBytes]) {
    try {
      const payload = decodeBunAuditPayload(raw);
      if (!payload) continue;
      const parsed: unknown = JSON.parse(payload);
      tried += 1;
      if (!isAuditReport(parsed)) {
        errors.push("JSON value is not a plain object of advisory arrays");
        continue;
      }
      return parsed;
    } catch (err) {
      tried += 1;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  // Nothing even looked like JSON — tool/network problem, not malformed data.
  // Distinct type so runBunAudit can retry it and the message can say so.
  if (tried === 0) throw new BunAuditUnavailableError(stdoutBytes, stderrBytes, exitCode);
  throw new Error(
    `bun audit returned non-JSON (tried ${tried} stream(s)):\n${errors.join("\n").slice(0, 400)}`,
  );
}

export interface AuditProcess {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
}

function spawnBunAudit(root: string): AuditProcess {
  return Bun.spawn(["bun", "audit", "--json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    // NO_COLOR — belt-and-suspenders with stripAnsi for colored --json.
    env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

const AUDIT_SIGKILL_GRACE_MS = 5_000;

export async function runBunAuditOnce(
  root: string,
  timeoutMs: number,
  spawnAudit: (root: string) => AuditProcess = spawnBunAudit,
): Promise<RawAuditReport> {
  const proc = spawnAudit(root);

  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
    // A child ignoring SIGTERM would keep `exited` pending forever.
    killTimer = setTimeout(() => proc.kill("SIGKILL"), AUDIT_SIGKILL_GRACE_MS);
  }, timeoutMs);
  let stdoutBytes: Uint8Array;
  let stderrBytes: Uint8Array;
  let exitCode: number;
  try {
    [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
      new Response(proc.stdout).bytes(),
      new Response(proc.stderr).bytes(),
      proc.exited,
    ]);
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
  }

  if (stdoutBytes.length === 0 && stderrBytes.length === 0) {
    throw new BunAuditUnavailableError(
      stdoutBytes,
      stderrBytes,
      exitCode,
      timedOut ? timeoutMs : undefined,
    );
  }
  try {
    return parseBunAuditStreams(stdoutBytes, stderrBytes, exitCode);
  } catch (err) {
    // A self-inflicted kill can leave banner or truncated JSON instead of
    // empty streams — that is a timeout, not malformed data, so it must be
    // retried like any other unavailable result.
    if (timedOut) {
      throw new BunAuditUnavailableError(stdoutBytes, stderrBytes, exitCode, timeoutMs);
    }
    throw err;
  }
}

// The advisory endpoint is a network call, and a single outage failed the whole
// security check — which gates the release job, so a blip blocked publishing
//. Only the "no JSON body" case retries;
// malformed-but-present JSON is a real parse problem and fails immediately.
const AUDIT_ATTEMPTS = 3;
const AUDIT_RETRY_DELAY_MS = 2_000;

// Extracted so the retry/timeout-budget policy is unit-testable without
// spawning the real `bun audit` subprocess — `now`/`sleep` are injectable for
// deterministic tests, real callers use the defaults (Date.now/Bun.sleep).
export async function retryWhileUnavailable<T>(
  attempt: (remainingMs: number) => Promise<T>,
  opts: {
    readonly attempts: number;
    readonly delayMs: number;
    readonly timeoutMs: number;
    readonly now?: () => number;
    readonly sleep?: (ms: number) => Promise<void>;
  },
): Promise<T> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  // Each attempt gets the full remaining budget, not an even slice — a
  // fast-failing 503 costs seconds and leaves the retry almost the whole
  // budget, while a slow attempt shouldn't be cut off artificially short.
  const deadline = now() + opts.timeoutMs;
  let lastUnavailable: BunAuditUnavailableError | undefined;
  for (let tries = 1; tries <= opts.attempts; tries++) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      const detail = lastUnavailable ? `\n${lastUnavailable.message}` : "";
      throw new Error(
        `timeout budget (${opts.timeoutMs}ms) exhausted before attempt ${tries}/${opts.attempts}${detail}`,
      );
    }
    try {
      return await attempt(remaining);
    } catch (err) {
      if (!(err instanceof BunAuditUnavailableError)) throw err;
      lastUnavailable = err;
      if (tries < opts.attempts) {
        console.warn(
          `  bun audit returned no JSON body (attempt ${tries}/${opts.attempts}) — retry in ${opts.delayMs}ms\n  ${err.message}`,
        );
        await sleep(opts.delayMs * tries);
      }
    }
  }
  throw lastUnavailable;
}

// Upper bound for the rare hang, not the normal case — the audit is usually fast.
export const AUDIT_TIMEOUT_MS = 480_000;

export async function runBunAudit(
  root: string,
  timeoutMs = AUDIT_TIMEOUT_MS,
): Promise<RawAuditReport> {
  try {
    return await retryWhileUnavailable((remaining) => runBunAuditOnce(root, remaining), {
      attempts: AUDIT_ATTEMPTS,
      delayMs: AUDIT_RETRY_DELAY_MS,
      timeoutMs,
    });
  } catch (err) {
    if (err instanceof BunAuditUnavailableError) {
      throw new Error(
        `bun audit failed in ${root} after ${AUDIT_ATTEMPTS} attempts:\n${err.message}`,
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`bun audit failed in ${root}:\n${detail}`);
  }
}
