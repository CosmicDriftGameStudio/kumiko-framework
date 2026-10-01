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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

// Server-side only: a declared sourceRoot under a mobile/client app has no server secrets to leak.
const CLIENT_SOURCE_ROOT = /(?:^|\/)mobile(?:\/|$)/;

function serverSourceRoots(root: RepoRoot): readonly string[] {
  return root.manifest.sourceRoots.filter((sourceRoot) => !CLIENT_SOURCE_ROOT.test(sourceRoot));
}

const EXCLUDE_DIR = /(?:^|\/)(?:node_modules|dist|__tests__)\//;
const IS_TEST = /\.(?:test|integration)\.tsx?$/;
// The one accepted home for dev-secret fallbacks (see header).
const DEV_ENTRYPOINT = /(?:^|\/)bin\/server\.ts$/;

// A `?? "literal"` / `|| "literal"` nullish/or fallback to a string literal.
const STRING_FALLBACK = /(?:\?\?|\|\|)\s*(['"`])([^'"`\n]+)\1/;
// A secret-like identifier. Matched only against the text LEFT of the fallback
// (assignee / property name): `cfg.title ?? "Secret Santa"` is a label, not a secret.
const SECRET_NAME =
  /[\w$]*(?:secret|password|passphrase|hmac|private[_-]?key|signing[_-]?key)[\w$]*/i;
// Short / numeric literals are versions or flags (e.g. `_CURRENT_VERSION ?? "1"`),
// never a usable secret.
const TRIVIAL_LITERAL = /^[\d.]+$/;
const MIN_SECRET_LENGTH = 8;
const IGNORE_TAG = "kumiko-lint-ignore secret-literal";

export type SecretLiteralFinding = {
  readonly file: string;
  readonly line: number;
  /** Assignee / property name left of the fallback. Never the literal. */
  readonly name: string;
  readonly literalLength: number;
};

type CommentStripResult = { readonly code: string; readonly inBlockComment: boolean };

// Drops line comments and block comments (state carries across lines via
// `startsInBlockComment`). Quote tracking keeps `//` and `/*` inside string
// literals (postgres://…, "src/*") from being read as comment starts, which
// would cut connection-string fallbacks off before their closing quote.
function stripComments(line: string, startsInBlockComment: boolean): CommentStripResult {
  let code = "";
  let inBlock = startsInBlockComment;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    const next = line[i + 1];
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (quote !== null) {
      code += ch;
      if (ch === "\\" && next !== undefined) {
        code += next;
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "/" && next === "/") break;
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    code += ch;
  }
  return { code, inBlockComment: inBlock };
}

export type SecretLiteralHit = {
  readonly lineNumber: number;
  readonly name: string;
  readonly literalLength: number;
};

/**
 * Sequential per-file scan: block-comment state carries across lines, so only
 * text inside an open block comment is skipped (a wrapped code line that
 * starts with `*` is still checked). Opt-out: `// kumiko-lint-ignore
 * secret-literal <reason>` on the line itself or the line above.
 */
export function scanLinesForSecretLiterals(lines: readonly string[]): SecretLiteralHit[] {
  const hits: SecretLiteralHit[] = [];
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const scanned = stripComments(raw, inBlockComment);
    inBlockComment = scanned.inBlockComment;
    const match = STRING_FALLBACK.exec(scanned.code);
    if (!match) continue;
    const literal = match[2];
    if (!literal || literal.length < MIN_SECRET_LENGTH || TRIVIAL_LITERAL.test(literal)) continue;
    const name = SECRET_NAME.exec(scanned.code.slice(0, match.index))?.[0];
    if (name === undefined) continue;
    if (raw.includes(IGNORE_TAG) || (lines[i - 1] ?? "").includes(IGNORE_TAG)) continue;
    hits.push({ lineNumber: i + 1, name, literalLength: literal.length });
  }
  return hits;
}

async function scanRoot(
  root: RepoRoot,
): Promise<{ readonly findings: SecretLiteralFinding[]; readonly scannedFiles: number }> {
  const findings: SecretLiteralFinding[] = [];
  let scannedFiles = 0;
  for (const sourceRoot of serverSourceRoots(root)) {
    for (const rel of new Glob(`${sourceRoot}/**/*.ts`).scanSync({ cwd: root.absPath })) {
      if (EXCLUDE_DIR.test(`/${rel}`) || IS_TEST.test(rel) || DEV_ENTRYPOINT.test(rel)) {
        continue;
      }
      scannedFiles++;
      const lines = readFileSync(join(root.absPath, rel), "utf8").split("\n");
      for (const hit of scanLinesForSecretLiterals(lines)) {
        findings.push({
          file: rel,
          line: hit.lineNumber,
          name: hit.name,
          literalLength: hit.literalLength,
        });
      }
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
      violations: findings.map((f) => ({
        file: f.file,
        line: f.line,
        message: `hardcoded secret fallback for "${f.name}" (${f.literalLength} chars)`,
      })),
      matchedFiles: scannedFiles,
      notApplicable: false,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check], resolveRepoRoots()));
  process.exit(failed > 0 ? 1 : 0);
}
