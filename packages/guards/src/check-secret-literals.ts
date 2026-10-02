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
import { ts } from "ts-morph";
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
const STRING_FALLBACK = /(?:\?\?|\|\|)\s*(['"`])([^'"`\n]+)\1/g;
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

const isJsDocKind = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstJSDocNode && kind <= ts.SyntaxKind.LastJSDocNode;

// Blanks every comment with spaces (newlines kept, so line numbers survive).
// The real TypeScript parser decides what is a comment: a hand-rolled
// per-line tokenizer misreads regex literals (`/^https?:\/*/`) and template
// continuation lines as comment starts and then skips code, which would make
// this security guard fail open. Trivia between two tokens contains only
// whitespace and comments, so it is masked directly from the token gaps.
function maskComments(source: string): string {
  const sourceFile = ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, false);
  const chars = [...source];
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " ";
  };
  const visit = (node: ts.Node): void => {
    const children = node.getChildren(sourceFile).filter((child) => !isJsDocKind(child.kind));
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    const trivia = source.slice(node.pos, node.getStart(sourceFile));
    for (const m of trivia.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) {
      blank(node.pos + m.index, node.pos + m.index + m[0].length);
    }
  };
  visit(sourceFile);
  return chars.join("");
}

export type SecretLiteralHit = {
  readonly lineNumber: number;
  readonly name: string;
  readonly literalLength: number;
};

// Literal content alone is enough when it names key material; bare
// secret/password stays name-only so "Secret Santa" labels are not flagged.
const SECRET_LITERAL_TOKEN = /hmac|private[_-]?key|signing[_-]?key/i;
// Assignee / property name directly left of the fallback (`k = …`, `key: …`).
const LHS_NAME = /([\w$]+)\s*[:=][^:=]*$/;
const UNNAMED_PLACEHOLDER = "<unnamed>";

/**
 * Per-file scan on comment-masked source (see maskComments), so only comment
 * text is skipped and a wrapped code line that starts with `*` is still
 * checked. Opt-out: `// kumiko-lint-ignore secret-literal <reason>` on the
 * line itself or the line above (checked on the raw lines).
 */
export function scanLinesForSecretLiterals(lines: readonly string[]): SecretLiteralHit[] {
  const hits: SecretLiteralHit[] = [];
  const maskedLines = maskComments(lines.join("\n")).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const code = maskedLines[i] ?? "";
    if (raw.includes(IGNORE_TAG) || (lines[i - 1] ?? "").includes(IGNORE_TAG)) continue;
    // Every fallback on the line is inspected; the name is read only from the text since the
    // previous fallback, so an earlier assignee cannot lend its name to a later literal.
    let previousEnd = 0;
    for (const match of code.matchAll(STRING_FALLBACK)) {
      const left = code.slice(previousEnd, match.index);
      previousEnd = match.index + match[0].length;
      const literal = match[2];
      if (!literal || literal.length < MIN_SECRET_LENGTH || TRIVIAL_LITERAL.test(literal)) continue;
      const name =
        SECRET_NAME.exec(left)?.[0] ??
        (SECRET_LITERAL_TOKEN.test(literal)
          ? (LHS_NAME.exec(left)?.[1] ?? UNNAMED_PLACEHOLDER)
          : undefined);
      if (name === undefined) continue;
      hits.push({ lineNumber: i + 1, name, literalLength: literal.length });
      break;
    }
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
