// Security check: `bun audit` over the lockfile of ONE repo.
//
// Single-repo by design: audits the bun.lock in the scanned repo's root. A repo without its
// own bun.lock falls back to the nearest ancestor's (a parent workspace), announced loudly.
// Critical/high advisories block unless covered by a short-lived exception; so does any
// exception expiring within EXPIRY_BLOCK_DAYS. Exceptions merge the bundled
// dependency-security-exceptions.json with an optional file of the same name in the repo root
// (and in the ancestor holding the lockfile, when that is not the repo root).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDependencyCli } from "./_lib/dependency-cli";
import { expiryEndMs, findExpiringSoon, loadExceptionEntries } from "./_lib/dependency-exceptions";
import {
  type AuditAdvisory,
  evaluateSecurity,
  parseAuditReport,
  type RawAuditReport,
  runBunAudit,
  type SecurityEvaluation,
  type SecurityException,
} from "./_lib/security-audit";

export const SECURITY_EXCEPTIONS_FILE = "dependency-security-exceptions.json";

// Block a PR while there is still runway to act, not on the day the advisory re-blocks;
// the 30-day console warning is invisible in green CI logs.
export const EXPIRY_BLOCK_DAYS = 14;

export function loadSecurityExceptions(
  roots: readonly string[],
  bundledDir?: string,
): SecurityException[] {
  return loadExceptionEntries({
    filename: SECURITY_EXCEPTIONS_FILE,
    roots,
    bundledDir,
    parse: (field) => ({
      advisory: field("advisory"),
      package: field("package"),
      reason: field("reason"),
      reviewedBy: field("reviewedBy"),
      expires: field("expires"),
    }),
  }).filter((exception) => {
    const hasDate = expiryEndMs(exception.expires) !== undefined;
    if (!hasDate) {
      console.warn(
        `  WARN: security exception ${exception.advisory} dropped, expires "${exception.expires}" is not a YYYY-MM-DD date. Set expires to a date like 2026-12-31.`,
      );
    }
    return hasDate;
  });
}

/** Directory whose bun.lock `bun audit` runs against: the repo root, else the nearest ancestor with one. */
export function findLockfileDir(repoRoot: string): string | undefined {
  for (let dir = repoRoot; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "bun.lock"))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

export function shouldBlock(
  evaluation: Pick<SecurityEvaluation, "blocking">,
  expiringUrgent: readonly SecurityException[],
): boolean {
  return evaluation.blocking.length > 0 || expiringUrgent.length > 0;
}

function printReport(
  evaluation: SecurityEvaluation,
  exceptions: readonly SecurityException[],
  expiringUrgent: readonly SecurityException[],
  nowMs: number,
): void {
  const { counts, blocking, warnings, suppressed } = evaluation;
  const total = counts.critical + counts.high + counts.moderate + counts.low + counts.info;
  console.log(
    `  ${total} advisories — critical: ${counts.critical}  high: ${counts.high}  moderate: ${counts.moderate}  low: ${counts.low}`,
  );

  if (blocking.length > 0) {
    console.error("\n  BLOCKING vulnerabilities:\n");
    for (const adv of blocking) {
      console.error(
        `    [${adv.severity.toUpperCase()}]  ${adv.package}  ${adv.advisoryId}  ${adv.title}`,
      );
    }
  }

  if (warnings.length > 0) {
    console.log("\n  WARN (moderate, not blocking):");
    for (const adv of warnings) {
      console.log(`    [MODERATE]  ${adv.package}  ${adv.advisoryId}  ${adv.title}`);
    }
  }

  if (suppressed.length > 0) {
    console.log(`\n  Suppressed via exception (${suppressed.length}):`);
    for (const adv of suppressed.slice(0, 10)) {
      console.log(`    [${adv.severity}]  ${adv.package}  ${adv.advisoryId}`);
    }
    if (suppressed.length > 10) console.log(`    … and ${suppressed.length - 10} more`);
  }

  if (expiringUrgent.length > 0) {
    console.error(
      `\n  BLOCKING: security exceptions expire within ${EXPIRY_BLOCK_DAYS} days — bump the dependency or re-review the exception now:`,
    );
    for (const ex of expiringUrgent) {
      console.error(`    ${ex.package}  ${ex.advisory}  expires=${ex.expires}`);
    }
  }

  const urgentKeys = new Set(expiringUrgent.map((ex) => `${ex.package}|${ex.advisory}`));
  const expiringSoon = findExpiringSoon(exceptions, 30, nowMs).filter(
    (ex) => !urgentKeys.has(`${ex.package}|${ex.advisory}`),
  );
  if (expiringSoon.length > 0) {
    console.log("\n  WARN: security exceptions expire within 30 days — re-review:");
    for (const ex of expiringSoon) {
      console.log(`    ${ex.package}  ${ex.advisory}  expires=${ex.expires}`);
    }
  }

  if (shouldBlock(evaluation, expiringUrgent)) {
    console.error(
      `\n  Fix dependencies or add short-lived exceptions in ${SECURITY_EXCEPTIONS_FILE} in the repo root\n`,
    );
  }
}

export async function runSecurityCheck(options: {
  readonly repoRoot: string;
  readonly reportOnly: boolean;
  readonly runAudit?: (lockfileDir: string) => Promise<RawAuditReport>;
  readonly exceptions?: readonly SecurityException[];
  readonly nowMs?: number;
}): Promise<number> {
  const nowMs = options.nowMs ?? Date.now();
  const lockfileDir = findLockfileDir(options.repoRoot);
  if (lockfileDir === undefined) {
    console.error(
      `  security: no bun.lock found in ${options.repoRoot} or any ancestor — nothing to audit. Run bun install to create bun.lock.`,
    );
    return 1;
  }
  if (lockfileDir !== options.repoRoot) {
    console.warn(
      `  WARN: ${options.repoRoot} has no bun.lock — auditing ${lockfileDir}/bun.lock instead (it may cover more than this repo).`,
    );
  }

  const exceptions = options.exceptions ?? loadSecurityExceptions([options.repoRoot, lockfileDir]);
  console.log(`Security audit: scanning ${lockfileDir} …`);
  const raw = await (options.runAudit ?? runBunAudit)(lockfileDir);
  const advisories: AuditAdvisory[] = parseAuditReport(raw);

  const evaluation = evaluateSecurity(advisories, exceptions, nowMs);
  // Only exceptions that suppressed an advisory in this run block; unused bundled ones must not break consumer CI.
  const expiringUrgent = findExpiringSoon(evaluation.usedExceptions, EXPIRY_BLOCK_DAYS, nowMs);
  printReport(evaluation, exceptions, expiringUrgent, nowMs);

  if (options.reportOnly) return 0;
  return shouldBlock(evaluation, expiringUrgent) ? 1 : 0;
}

export async function runSecurityCli(
  argv: readonly string[],
  cwd: string = process.cwd(),
): Promise<number> {
  const invocation = parseDependencyCli("security", argv, cwd);
  if (!invocation.ok) return invocation.exitCode;
  try {
    return await runSecurityCheck({
      repoRoot: invocation.repoRoot,
      reportOnly: invocation.reportOnly,
    });
  } catch (err) {
    console.error("Security check failed:", err);
    return 1;
  }
}
