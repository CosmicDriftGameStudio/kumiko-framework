#!/usr/bin/env bun
/**
 * Secret-Literal-Guard (stack-agnostisch).
 *
 * Flaggt hartkodierte Secret-Fallbacks in Server-Code:
 *   const s = env.JWT_SECRET ?? "hardcoded-prod-secret";   // ✗
 *   hmacSecret: config.X ?? "cashcolt-mailer-hmac-secret", // ✗
 *
 * Ein `?? "<literal>"`-Fallback auf etwas Secret-artiges heißt: fehlt die
 * Env-Variable, läuft der Server mit einem im Repo sichtbaren Secret weiter —
 * genau die Klasse, die bei einem Deploy-Fehler zum geleakten Prod-Secret wird.
 * Secure-by-default: fehlendes Secret → hart fehlschlagen, nie auf ein Literal
 * zurückfallen.
 *
 * AKZEPTIERTE AUSNAHME: `bin/server.ts` ist der designierte DEV-Entrypoint
 * (runDevApp). Dort sind Dev-Secret-Fallbacks gewollt — der PROD-Entrypoint
 * `bin/main.ts` (runProdApp) liest dieselben Secrets aus dem validierten Env
 * und failt hart. Der Guard akzeptiert Literale daher nur in `bin/server.ts`
 * und flaggt sie überall sonst (Prod-Entrypoint, Config-Module, Handler, Lib).
 *
 * Scannt den eigenen Checkout (die `roots`, die der Runner auflöst) —
 * jedes Repo läuft diesen Check in seiner eigenen CI gegen sich selbst,
 * statt dass ein zentraler Scan in fremde Sibling-Checkouts greift.
 */
import { join } from "node:path";
import { Glob } from "bun";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";
import { scanLinesForPredicate } from "./_lib/scan-lines";

// Server-side only: apps/server (not apps/mobile — client code, no server secrets).
const SCAN_PATTERNS: ReadonlyArray<string> = [
  "bin/**/*.ts",
  "src/**/*.ts",
  "apps/server/src/**/*.ts",
  "packages/*/src/**/*.ts",
];

const EXCLUDE_DIR = /(?:^|\/)(?:node_modules|dist|__tests__)\//;
const IS_TEST = /\.(?:test|integration)\.tsx?$/;
// The one accepted home for dev-secret fallbacks (see header).
const DEV_ENTRYPOINT = /(?:^|\/)bin\/server\.ts$/;

// A `?? "literal"` / `|| "literal"` nullish/or fallback to a string literal.
const STRING_FALLBACK = /(?:\?\?|\|\|)\s*(['"`])([^'"`\n]+)\1/;
// ...on a line that is about a secret (assignee name or the literal itself).
const SECRET_CONTEXT = /secret|password|passphrase|hmac|private[_-]?key|signing[_-]?key/i;
// Short / numeric literals are versions or flags (e.g. `_CURRENT_VERSION ?? "1"`),
// never a usable secret.
const TRIVIAL_LITERAL = /^[\d.]+$/;

export type SecretLiteralFinding = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
};

/** Returns the offending literal, or null when the line is clean. */
export function secretLiteralOnLine(line: string): string | null {
  // Only the line start counts as a comment (`//`, or a block-comment line
  // starting with `*`/`/*`/`*/`): stripping from the first `//` anywhere in
  // the line would cut connection-string fallbacks (postgres://, redis://,
  // https://token@host/…) off before their closing quote, losing findings.
  const code = /^\s*(?:\/\/|\/\*|\*\/|\*)/.test(line) ? "" : line;
  if (!SECRET_CONTEXT.test(code)) return null;
  const match = STRING_FALLBACK.exec(code);
  if (!match) return null;
  const literal = match[2];
  if (!literal || literal.length < 8 || TRIVIAL_LITERAL.test(literal)) return null;
  return literal;
}

async function scanRoot(
  root: RepoRoot,
): Promise<{ readonly findings: SecretLiteralFinding[]; readonly scannedFiles: number }> {
  const findings: SecretLiteralFinding[] = [];
  let scannedFiles = 0;
  for (const pattern of SCAN_PATTERNS) {
    for (const rel of new Glob(pattern).scanSync({ cwd: root.absPath })) {
      if (EXCLUDE_DIR.test(`/${rel}`) || IS_TEST.test(rel) || DEV_ENTRYPOINT.test(rel)) {
        continue;
      }
      const abs = join(root.absPath, rel);
      scannedFiles++;
      scanLinesForPredicate(abs, rel, (line) => secretLiteralOnLine(line) !== null, findings);
    }
  }
  return { findings, scannedFiles };
}

export async function scanSecretLiterals(roots: readonly RepoRoot[]): Promise<{
  readonly findings: SecretLiteralFinding[];
  readonly scannedFiles: number;
}> {
  const findings: SecretLiteralFinding[] = [];
  let scannedFiles = 0;
  for (const root of roots) {
    const result = await scanRoot(root);
    findings.push(...result.findings);
    scannedFiles += result.scannedFiles;
  }
  return { findings, scannedFiles };
}

export const check: RepoCheck = {
  name: "Secret-Literal Guard",
  hint:
    "A missing secret must fail hard, never fall back to a literal. " +
    "Read from the validated env (throw if missing). Dev-only fallbacks belong in bin/server.ts.",
  async run(roots) {
    if (roots.length === 0) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }
    const { findings, scannedFiles } = await scanSecretLiterals(roots);
    return {
      violations: findings.map((f) => ({ file: f.file, line: f.line, message: f.text })),
      matchedFiles: scannedFiles,
      notApplicable: false,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check], resolveRepoRoots()));
  process.exit(failed > 0 ? 1 : 0);
}
