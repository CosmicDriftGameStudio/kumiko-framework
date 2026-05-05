/**
 * Check: Lizenzen aller installierten Dependencies.
 *
 * Liest rekursiv jede package.json in node_modules, klassifiziert die Lizenz
 * gegen Allowlist/Graue-Zone/Denylist. Unbekannte Lizenzen werden hart
 * abgelehnt (manuelle Review noetig).
 *
 * Exceptions sind in dependency-license-exceptions.json dokumentiert —
 * jede Exception muss Grund + Reviewer + Ablaufdatum haben.
 *
 * Plan: docs/plans/architecture/dependency-checks.md
 *
 * Usage:
 *   yarn tsx scripts/check-licenses.ts
 *   yarn tsx scripts/check-licenses.ts --report   # Nur Report, kein Fail
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// --- Policies ---

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

// --- Types ---

interface PkgInfo {
  name: string;
  version: string;
  license: string | null;
  path: string;
}

interface Exception {
  package: string;
  version: string;
  license: string;
  reason: string;
  reviewedBy: string;
  expires: string; // ISO date
}

interface ExceptionsFile {
  exceptions: Exception[];
}

type Verdict =
  | { kind: "ok"; license: string }
  | { kind: "gray"; license: string; exception?: Exception }
  | { kind: "deny"; license: string; exception?: Exception }
  | { kind: "unknown"; raw: string | null; exception?: Exception };

// --- Main ---

function main(): void {
  const reportOnly = process.argv.includes("--report");

  const packages = collectPackages();
  const exceptions = loadExceptions();

  const verdicts = new Map<string, Verdict>();
  for (const pkg of packages) {
    verdicts.set(`${pkg.name}@${pkg.version}`, judge(pkg, exceptions));
  }

  printReport(packages, verdicts);

  const blocked = findBlocked(packages, verdicts);
  const warned = findWarned(packages, verdicts);

  if (reportOnly) {
    return;
  }

  if (blocked.length > 0) {
    console.error(`\n  BLOCKED: ${blocked.length} Package(s) mit problematischer Lizenz.`);
    console.error(`  Entweder Dependency entfernen oder Exception eintragen in:`);
    console.error(`    dependency-license-exceptions.json\n`);
    process.exit(1);
  }

  if (warned.length > 0) {
    console.log(`\n  ${warned.length} Graue-Zone-Package(s) — durch Exceptions gedeckt.`);
  }
}

// --- Collect ---

function collectPackages(): PkgInfo[] {
  const seen = new Map<string, PkgInfo>();

  walkNodeModules(path.join(ROOT, "node_modules"), seen);

  // Auch die Workspace-internen node_modules durchgehen (monorepo)
  const workspaceRoots = [
    "packages/framework",
    "packages/bundled-features",
    "app",
  ];
  for (const ws of workspaceRoots) {
    const wsNm = path.join(ROOT, ws, "node_modules");
    if (fs.existsSync(wsNm)) {
      walkNodeModules(wsNm, seen);
    }
  }

  return Array.from(seen.values()).sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
}

function walkNodeModules(dir: string, seen: Map<string, PkgInfo>): void {
  if (!fs.existsSync(dir)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;

    const full = path.join(dir, entry.name);

    if (entry.name.startsWith("@")) {
      // Scoped packages — walk into them
      walkNodeModules(full, seen);
      continue;
    }

    const pkgJsonPath = path.join(full, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      const info = readPkgInfo(pkgJsonPath);
      if (info) {
        const key = `${info.name}@${info.version}`;
        if (!seen.has(key)) seen.set(key, info);
      }
    }

    // Nested node_modules
    const nestedNm = path.join(full, "node_modules");
    if (fs.existsSync(nestedNm)) {
      walkNodeModules(nestedNm, seen);
    }
  }
}

function readPkgInfo(pkgJsonPath: string): PkgInfo | null {
  try {
    const content = fs.readFileSync(pkgJsonPath, "utf-8");
    const pkg = JSON.parse(content) as {
      name?: string;
      version?: string;
      license?: string | { type?: string } | Array<string | { type?: string }>;
      licenses?: Array<string | { type?: string }>;
      private?: boolean;
    };

    if (!pkg.name || !pkg.version) return null;
    // Skip our own workspace packages (they are internal, private)
    if (pkg.private && pkg.name.startsWith("@kumiko/")) return null;

    return {
      name: pkg.name,
      version: pkg.version,
      license: normalizeLicense(pkg.license ?? pkg.licenses),
      path: pkgJsonPath,
    };
  } catch {
    return null;
  }
}

function normalizeLicense(
  raw: string | { type?: string } | Array<string | { type?: string }> | undefined,
): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    const parts = raw
      .map((r) => (typeof r === "string" ? r : r?.type))
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0]!.trim();
    return `(${parts.join(" OR ")})`;
  }
  if (typeof raw === "object" && raw && typeof raw.type === "string") {
    return raw.type.trim();
  }
  return null;
}

// --- Judge ---

function loadExceptions(): ExceptionsFile {
  const file = path.join(ROOT, "dependency-license-exceptions.json");
  if (!fs.existsSync(file)) return { exceptions: [] };
  try {
    const content = fs.readFileSync(file, "utf-8");
    return JSON.parse(content) as ExceptionsFile;
  } catch {
    console.warn(`  WARN: ${path.basename(file)} ist nicht lesbar — ignoriere.`);
    return { exceptions: [] };
  }
}

function findException(pkg: PkgInfo, exceptions: ExceptionsFile): Exception | undefined {
  return exceptions.exceptions.find((e) => {
    if (!matchesPackageName(e.package, pkg.name)) return false;
    // Version ist entweder exakt gleich oder ^-Pattern akzeptieren wir kulant als "passt"
    if (e.version === "*" || e.version === pkg.version) return true;
    if (e.version.startsWith("^") || e.version.startsWith("~")) return true;
    return false;
  });
}

// Wildcard-Match für Plattform-Binary-Paketnamen ("lightningcss-*" matched
// alle 10 lightningcss-{darwin,linux,android,freebsd,...}-Varianten).
// Trailing `*` ist der einzige unterstützte Wildcard — Substring-Matching
// im middle würde unsinnige False-Positives zulassen ("react-*" auf
// "react-dom" wäre nicht gemeint).
function matchesPackageName(pattern: string, name: string): boolean {
  if (pattern === name) return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    if (prefix.length === 0) return false; // "*" allein wäre zu permissiv
    return name.startsWith(prefix);
  }
  return false;
}

function isExceptionValid(e: Exception): { valid: boolean; expired: boolean } {
  if (!e.expires) return { valid: true, expired: false };
  const exp = new Date(e.expires);
  if (Number.isNaN(exp.getTime())) return { valid: false, expired: false };
  const expired = exp.getTime() < Date.now();
  return { valid: !expired, expired };
}

function judge(pkg: PkgInfo, exceptions: ExceptionsFile): Verdict {
  const license = pkg.license;
  const ex = findException(pkg, exceptions);

  if (!license) {
    return { kind: "unknown", raw: null, exception: ex };
  }

  // SPDX-Expression parsing: "(MIT OR Apache-2.0)" -> OR-Liste
  const orParts = parseOrExpression(license);
  const allParts = parseAndExpression(license);

  // AND: alle muessen allowlist sein
  if (allParts.length > 1) {
    if (allParts.every((p) => ALLOWLIST.has(p))) {
      return { kind: "ok", license };
    }
    if (allParts.some((p) => matchesDenylist(p))) {
      return { kind: "deny", license, exception: ex };
    }
    if (allParts.every((p) => ALLOWLIST.has(p) || GRAY_ZONE.has(p))) {
      return { kind: "gray", license, exception: ex };
    }
    return { kind: "unknown", raw: license, exception: ex };
  }

  // OR: einer reicht
  if (orParts.length > 1) {
    if (orParts.some((p) => ALLOWLIST.has(p))) {
      return { kind: "ok", license };
    }
    if (orParts.some((p) => GRAY_ZONE.has(p))) {
      return { kind: "gray", license, exception: ex };
    }
    if (orParts.every((p) => matchesDenylist(p))) {
      return { kind: "deny", license, exception: ex };
    }
    return { kind: "unknown", raw: license, exception: ex };
  }

  // Single license
  const clean = license.replace(/[()]/g, "").trim();
  if (ALLOWLIST.has(clean)) return { kind: "ok", license: clean };
  if (GRAY_ZONE.has(clean)) return { kind: "gray", license: clean, exception: ex };
  if (matchesDenylist(clean)) return { kind: "deny", license: clean, exception: ex };
  return { kind: "unknown", raw: clean, exception: ex };
}

function parseOrExpression(expr: string): string[] {
  const stripped = expr.replace(/[()]/g, "").trim();
  if (!/\bOR\b/i.test(stripped)) return [stripped];
  return stripped.split(/\s+OR\s+/i).map((p) => p.trim()).filter(Boolean);
}

function parseAndExpression(expr: string): string[] {
  const stripped = expr.replace(/[()]/g, "").trim();
  if (!/\bAND\b/i.test(stripped)) return [stripped];
  return stripped.split(/\s+AND\s+/i).map((p) => p.trim()).filter(Boolean);
}

function matchesDenylist(license: string): boolean {
  return DENYLIST_PATTERNS.some((p) => p.test(license));
}

// --- Report ---

function findBlocked(
  packages: PkgInfo[],
  verdicts: Map<string, Verdict>,
): Array<{ pkg: PkgInfo; verdict: Verdict }> {
  const result: Array<{ pkg: PkgInfo; verdict: Verdict }> = [];
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    const v = verdicts.get(key);
    if (!v) continue;
    if (v.kind === "deny") {
      if (!v.exception || !isExceptionValid(v.exception).valid) {
        result.push({ pkg, verdict: v });
      }
    } else if (v.kind === "unknown") {
      if (!v.exception || !isExceptionValid(v.exception).valid) {
        result.push({ pkg, verdict: v });
      }
    } else if (v.kind === "gray") {
      if (!v.exception || !isExceptionValid(v.exception).valid) {
        result.push({ pkg, verdict: v });
      }
    }
  }
  return result;
}

function findWarned(
  packages: PkgInfo[],
  verdicts: Map<string, Verdict>,
): Array<{ pkg: PkgInfo; verdict: Verdict }> {
  const result: Array<{ pkg: PkgInfo; verdict: Verdict }> = [];
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    const v = verdicts.get(key);
    if (v?.kind === "gray" && v.exception && isExceptionValid(v.exception).valid) {
      result.push({ pkg, verdict: v });
    }
  }
  return result;
}

function printReport(packages: PkgInfo[], verdicts: Map<string, Verdict>): void {
  const counts = { ok: 0, gray: 0, deny: 0, unknown: 0 };
  for (const v of verdicts.values()) counts[v.kind]++;

  console.log(`License-Check: ${packages.length} Packages gescannt.`);
  console.log(
    `  ok: ${counts.ok}  gray: ${counts.gray}  deny: ${counts.deny}  unknown: ${counts.unknown}`,
  );

  const blocked = findBlocked(packages, verdicts);
  if (blocked.length > 0) {
    console.error(`\n  Problematische Lizenzen:\n`);
    for (const { pkg, verdict } of blocked) {
      const licStr = verdict.kind === "unknown" ? String(verdict.raw) : (verdict as { license: string }).license;
      const kind =
        verdict.kind === "deny"
          ? "DENY"
          : verdict.kind === "unknown"
            ? "UNKNOWN"
            : "GRAY (no valid exception)";
      const expiredSuffix =
        verdict.exception && isExceptionValid(verdict.exception).expired
          ? ` (exception expired ${verdict.exception.expires})`
          : "";
      console.error(`    [${kind}]  ${pkg.name}@${pkg.version}  license=${licStr}${expiredSuffix}`);
    }
  }

  const warned = findWarned(packages, verdicts);
  if (warned.length > 0) {
    console.log(`\n  Graue-Zone (durch Exception gedeckt):`);
    for (const { pkg, verdict } of warned) {
      const licStr = (verdict as { license: string }).license;
      const expires = verdict.exception?.expires ?? "?";
      console.log(`    [GRAY/ok]  ${pkg.name}@${pkg.version}  license=${licStr}  expires=${expires}`);
    }
  }

  // Warnung fuer bald ablaufende Exceptions (30 Tage)
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const expiringSoon: Array<{ pkg: PkgInfo; verdict: Verdict }> = [];
  for (const pkg of packages) {
    const v = verdicts.get(`${pkg.name}@${pkg.version}`);
    if (!v || !("exception" in v) || !v.exception) continue;
    const exp = new Date(v.exception.expires);
    if (!Number.isNaN(exp.getTime()) && exp.getTime() <= soon.getTime() && exp.getTime() > Date.now()) {
      expiringSoon.push({ pkg, verdict: v });
    }
  }
  if (expiringSoon.length > 0) {
    console.log(`\n  WARN: Exceptions laufen innerhalb 30 Tage ab — Re-Review noetig:`);
    for (const { pkg, verdict } of expiringSoon) {
      console.log(`    ${pkg.name}@${pkg.version}  expires=${verdict.exception?.expires}`);
    }
  }
}

main();
