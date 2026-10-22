// Licence check over the installed third-party packages of ONE repo.
//
// Single-repo by design: the scanned repo is the one `cwd` sits in (the multi-repo
// workspace scan of the private infra guard is gone). Installed packages come from
// node_modules of the repo, its workspace members and every ancestor directory.
// Exceptions merge the bundled dependency-license-exceptions.json with an optional file of
// the same name in the repo root and in every ancestor whose node_modules was scanned.
import { parseDependencyCli } from "./_lib/dependency-cli";
import {
  findExpiringSoon,
  isExceptionValid,
  loadExceptionEntries,
  matchesPackageName,
} from "./_lib/dependency-exceptions";
import {
  collectInstalledPackages,
  type InstalledPackage,
  installationRoots,
} from "./_lib/installed-packages";

export const LICENSES_FLAGS: readonly string[] = ["--report"];

const ALLOWLIST = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSD-3-Clause-Clear",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "BlueOak-1.0.0",
  "Python-2.0",
  "PostgreSQL",
  "Zlib",
  "WTFPL",
  "Artistic-2.0",
]);

const GRAY_ZONE = new Set([
  "LGPL-2.0",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MPL-1.0",
  "MPL-1.1",
  "MPL-2.0",
  "CDDL-1.0",
  "CDDL-1.1",
  "EPL-1.0",
  "EPL-2.0",
]);

const DENYLIST_PATTERNS: RegExp[] = [
  /^GPL-\d/,
  /^AGPL-\d/,
  /^SSPL-/,
  /^BUSL-/,
  /Commons[ -]Clause/i,
  /^UNLICENSED$/i,
];

export const LICENSE_EXCEPTIONS_FILE = "dependency-license-exceptions.json";

export type LicenseException = {
  readonly package: string;
  readonly version: string;
  readonly license: string;
  readonly reason: string;
  readonly reviewedBy: string;
  readonly expires: string;
};

type Verdict =
  | { readonly kind: "ok"; readonly license: string }
  | { readonly kind: "gray"; readonly license: string; readonly exception?: LicenseException }
  | { readonly kind: "deny"; readonly license: string; readonly exception?: LicenseException }
  | {
      readonly kind: "unknown";
      readonly raw: string | null;
      readonly exception?: LicenseException;
    };

type Judged = { readonly pkg: InstalledPackage; readonly verdict: Verdict };

export function loadLicenseExceptions(
  roots: readonly string[],
  bundledDir?: string,
): LicenseException[] {
  return loadExceptionEntries({
    filename: LICENSE_EXCEPTIONS_FILE,
    roots,
    bundledDir,
    parse: (field) => ({
      package: field("package"),
      version: field("version"),
      license: field("license"),
      reason: field("reason"),
      reviewedBy: field("reviewedBy"),
      expires: field("expires"),
    }),
  });
}

function normalizeLicenseId(license: string): string {
  return license.replace(/[()]/g, "").trim().toUpperCase();
}

function exceptionMatchesPackage(e: LicenseException, pkg: InstalledPackage): boolean {
  if (!matchesPackageName(e.package, pkg.name)) return false;
  // A package without a license field has nothing to contradict the recorded license.
  if (pkg.license !== null && normalizeLicenseId(e.license) !== normalizeLicenseId(pkg.license)) {
    return false;
  }
  return (
    e.version === "*" || e.version === pkg.version || Bun.semver.satisfies(pkg.version, e.version)
  );
}

// A renewed repo exception must win over an expired bundled one for the same package, so prefer a
// still-valid match and only fall back to an expired one for the "expired" hint.
function findException(
  pkg: InstalledPackage,
  exceptions: readonly LicenseException[],
  nowMs: number,
): LicenseException | undefined {
  const matching = exceptions.filter((e) => exceptionMatchesPackage(e, pkg));
  return matching.find((e) => isExceptionValid(e.expires, nowMs).valid) ?? matching[0];
}

function splitExpression(expr: string, operator: "OR" | "AND"): string[] {
  const stripped = expr.replace(/[()]/g, "").trim();
  return stripped
    .split(new RegExp(`\\s+${operator}\\s+`, "i"))
    .map((p) => p.trim())
    .filter(Boolean);
}

function matchesDenylist(license: string): boolean {
  return DENYLIST_PATTERNS.some((p) => p.test(license));
}

export function judgeLicense(
  pkg: InstalledPackage,
  exceptions: readonly LicenseException[],
  nowMs: number = Date.now(),
): Verdict {
  const license = pkg.license;
  const exception = findException(pkg, exceptions, nowMs);
  if (!license) return { kind: "unknown", raw: null, exception };

  const andParts = splitExpression(license, "AND");
  if (andParts.length > 1) {
    if (andParts.every((p) => ALLOWLIST.has(p))) return { kind: "ok", license };
    if (andParts.some(matchesDenylist)) return { kind: "deny", license, exception };
    if (andParts.every((p) => ALLOWLIST.has(p) || GRAY_ZONE.has(p))) {
      return { kind: "gray", license, exception };
    }
    return { kind: "unknown", raw: license, exception };
  }

  const orParts = splitExpression(license, "OR");
  if (orParts.length > 1) {
    if (orParts.some((p) => ALLOWLIST.has(p))) return { kind: "ok", license };
    if (orParts.some((p) => GRAY_ZONE.has(p))) return { kind: "gray", license, exception };
    if (orParts.every(matchesDenylist)) return { kind: "deny", license, exception };
    return { kind: "unknown", raw: license, exception };
  }

  const clean = license.replace(/[()]/g, "").trim();
  if (ALLOWLIST.has(clean)) return { kind: "ok", license: clean };
  if (GRAY_ZONE.has(clean)) return { kind: "gray", license: clean, exception };
  if (matchesDenylist(clean)) return { kind: "deny", license: clean, exception };
  return { kind: "unknown", raw: clean, exception };
}

function hasValidException(verdict: Verdict, nowMs: number): boolean {
  return (
    "exception" in verdict &&
    verdict.exception !== undefined &&
    isExceptionValid(verdict.exception.expires, nowMs).valid
  );
}

export type LicenseEvaluation = {
  readonly judged: readonly Judged[];
  readonly blocked: readonly Judged[];
  readonly coveredGray: readonly Judged[];
};

export function evaluateLicenses(
  packages: readonly InstalledPackage[],
  exceptions: readonly LicenseException[],
  nowMs: number = Date.now(),
): LicenseEvaluation {
  const judged = packages.map((pkg) => ({ pkg, verdict: judgeLicense(pkg, exceptions, nowMs) }));
  const blocked = judged.filter(
    ({ verdict }) => verdict.kind !== "ok" && !hasValidException(verdict, nowMs),
  );
  const coveredGray = judged.filter(
    ({ verdict }) => verdict.kind === "gray" && hasValidException(verdict, nowMs),
  );
  return { judged, blocked, coveredGray };
}

function verdictLicense(verdict: Verdict): string {
  return verdict.kind === "unknown" ? String(verdict.raw) : verdict.license;
}

function describeBlocked({ pkg, verdict }: Judged, nowMs: number): string {
  const kind =
    verdict.kind === "deny"
      ? "DENY"
      : verdict.kind === "unknown"
        ? "UNKNOWN"
        : "GRAY (no valid exception)";
  const exception = "exception" in verdict ? verdict.exception : undefined;
  const expiredSuffix =
    exception && isExceptionValid(exception.expires, nowMs).expired
      ? ` (exception expired ${exception.expires})`
      : "";
  return `    [${kind}]  ${pkg.name}@${pkg.version}  license=${verdictLicense(verdict)}${expiredSuffix}`;
}

function describeCoveredGray({ pkg, verdict }: Judged): string {
  const exception = "exception" in verdict ? verdict.exception : undefined;
  return `    [GRAY/ok]  ${pkg.name}@${pkg.version}  license=${verdictLicense(verdict)}  expires=${exception?.expires ?? "?"}`;
}

function printReport(evaluation: LicenseEvaluation, nowMs: number): void {
  const counts = { ok: 0, gray: 0, deny: 0, unknown: 0 };
  for (const { verdict } of evaluation.judged) counts[verdict.kind]++;
  console.log(`License check: ${evaluation.judged.length} packages scanned.`);
  console.log(
    `  ok: ${counts.ok}  gray: ${counts.gray}  deny: ${counts.deny}  unknown: ${counts.unknown}`,
  );

  if (evaluation.blocked.length > 0) {
    console.error("\n  Problematic licenses:\n");
    for (const judged of evaluation.blocked) console.error(describeBlocked(judged, nowMs));
  }

  if (evaluation.coveredGray.length > 0) {
    console.log("\n  Gray zone (covered by exception):");
    for (const judged of evaluation.coveredGray) console.log(describeCoveredGray(judged));
  }

  const used = evaluation.judged.flatMap(({ verdict }) =>
    "exception" in verdict && verdict.exception ? [verdict.exception] : [],
  );
  const expiring = findExpiringSoon(used, 30, nowMs);
  if (expiring.length > 0) {
    console.log("\n  WARN: exceptions expire within 30 days — re-review:");
    for (const exception of expiring) {
      console.log(`    ${exception.package}  expires=${exception.expires}`);
    }
  }
}

export function runLicenseCheck(options: {
  readonly repoRoot: string;
  readonly reportOnly: boolean;
  readonly packages?: readonly InstalledPackage[];
  readonly exceptions?: readonly LicenseException[];
  readonly nowMs?: number;
}): number {
  const nowMs = options.nowMs ?? Date.now();
  const packages = options.packages ?? collectInstalledPackages(options.repoRoot);
  if (packages.length === 0) {
    console.error(
      `  licenses: nothing scanned — no installed packages found for ${options.repoRoot} (run \`bun install\`).`,
    );
    return 1;
  }
  const exceptions =
    options.exceptions ?? loadLicenseExceptions(installationRoots(options.repoRoot));
  const evaluation = evaluateLicenses(packages, exceptions, nowMs);
  printReport(evaluation, nowMs);
  if (options.reportOnly) return 0;

  if (evaluation.blocked.length > 0) {
    console.error(
      `\n  BLOCKED: ${evaluation.blocked.length} package(s) with a problematic license.`,
    );
    console.error(
      `  Remove the dependency or add an exception to ${LICENSE_EXCEPTIONS_FILE} in the repo root.\n`,
    );
    return 1;
  }
  if (evaluation.coveredGray.length > 0) {
    console.log(`\n  ${evaluation.coveredGray.length} gray-zone package(s) covered by exceptions.`);
  }
  return 0;
}

export function runLicensesCli(argv: readonly string[], cwd: string = process.cwd()): number {
  const invocation = parseDependencyCli("licenses", argv, cwd);
  if (!invocation.ok) return invocation.exitCode;
  return runLicenseCheck({ repoRoot: invocation.repoRoot, reportOnly: invocation.reportOnly });
}
