#!/usr/bin/env bun
/**
 * Guard: finds raw `fetch(` calls in server code outside the client-scoped
 * exceptions.
 *
 * `egress(policy)` (@cosmicdrift/kumiko-framework/http, framework#2147) is
 * the single exported way for server code to speak outward — it enforces an
 * SSRF policy (external/internal/tenant-supplied) at the call site instead
 * of leaving that to convention. This guard fails on raw `fetch(` in server
 * code so a new call site can't silently skip the policy.
 *
 * Scoping: client code legitimately calls `fetch(` against its own origin
 * (browser same-origin, not server egress) — excluded via path (`web/`,
 * `public/`). Server scans are `*.ts` only (`SCAN`).
 *
 * Usage:
 *   bun guards/guard-direct-fetch.ts
 *
 * Exit 1 on violations in non-allowlisted files, 0 when clean.
 */

import { relative as pathRelative } from "node:path";
import { type CallExpression, type Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  findRepoRootFor,
  isAllowlisted,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

const EXCLUDE =
  /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$|(?:^|\/)web\/|(?:^|\/)public\/)/;

// Prefixed by RepoRoot.name (not kind): kind "app" is shared across
// unregistered repos (infra#560).

// packages/framework/src/http/egress.ts IS the egress() implementation.
const ALLOWLIST = [/^kumiko-framework\/packages\/framework\/src\/http\/egress\.ts$/];
const ALLOW_MARKER = "guard-allow: same-origin fetch";

interface Violation {
  line: number;
  snippet: string;
}

// `self` omitted: Worker globals live under web/public (excluded); a local
// `const self = this` binding was a systematic FP (infra#582).
const GLOBAL_FETCH_RECEIVERS = new Set(["globalThis", "window"]);

function hasAllowMarker(sf: SourceFile, line: number): boolean {
  const lines = sf.getFullText().split("\n");
  const idx = line - 1;
  const cur = lines[idx] ?? "";
  const prev = lines[idx - 1] ?? "";
  return cur.includes(ALLOW_MARKER) || prev.includes(ALLOW_MARKER);
}

/** Same-origin path literal (`"/api/..."`, '`/demo`') — not an SSRF risk. */
function isSameOriginLiteralArg(expr: CallExpression): boolean {
  const arg = expr.getArguments()[0];
  if (!arg) return false;

  const template = arg.asKind(SyntaxKind.TemplateExpression);
  if (template) {
    const head = template.getHead().getLiteralText();
    // A lone "/" head lets the first interpolation open with another "/",
    // producing a protocol-relative "//evil.example" — require at least one
    // static character after the leading slash so no interpolation can
    // change the origin.
    return head.startsWith("/") && !head.startsWith("//") && head.length >= 2;
  }

  if (
    arg.getKind() !== SyntaxKind.StringLiteral &&
    arg.getKind() !== SyntaxKind.NoSubstitutionTemplateLiteral
  ) {
    return false;
  }
  const path = arg.getText().slice(1, -1);
  // Reject protocol-relative URLs ("//evil.example") — not same-origin.
  return path.startsWith("/") && !path.startsWith("//");
}

function isGlobalFetchAccess(callee: Node): boolean {
  const pae = callee.asKind(SyntaxKind.PropertyAccessExpression);
  if (!pae || pae.getName() !== "fetch") return false;
  const receiver = pae.getExpression();
  return (
    receiver.getKind() === SyntaxKind.Identifier && GLOBAL_FETCH_RECEIVERS.has(receiver.getText())
  );
}

function findRawFetchCalls(sf: SourceFile): Violation[] {
  const violations: Violation[] = [];
  for (const expr of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = expr.getExpression();
    const isBareFetch = callee.getKind() === SyntaxKind.Identifier && callee.getText() === "fetch";
    if (!(isBareFetch || isGlobalFetchAccess(callee))) continue;
    if (isSameOriginLiteralArg(expr)) continue;
    violations.push({
      line: expr.getStartLineNumber(),
      snippet: expr.getText().slice(0, 120),
    });
  }
  return violations;
}

export const guard: AstGuard = {
  name: "Direct-Fetch Guard",
  scan: SCAN,
  security: true,
  hint:
    "Replace raw fetch(...) with egress(policy)(...) from @cosmicdrift/kumiko-framework/http (framework#2147). " +
    'Same-origin path literal (`"/api/..."`) is allowed; otherwise put `// guard-allow: same-origin fetch` on the line above. ' +
    "Local bindings named fetch are flagged (false positive — unblock via that marker or ALLOWLIST in infra/guards/guard-direct-fetch.ts). " +
    'Known gap: bracket access (globalThis["fetch"](...)).',
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];
    const roots = resolveRepoRoots();

    for (const sf of files) {
      const file = sf.getFilePath();
      const rel = relFromRepoRoot(file, roots);
      if (EXCLUDE.test(rel)) continue;
      const root = findRepoRootFor(file, roots);
      const key =
        root === undefined ? undefined : `${root.name}/${pathRelative(root.absPath, file)}`;
      if (key !== undefined && isAllowlisted(key, ALLOWLIST)) continue;
      for (const v of findRawFetchCalls(sf)) {
        if (hasAllowMarker(sf, v.line)) continue;
        violations.push({
          // cwd-relative, not repo-relative `rel` — the security baseline
          // needs an unambiguous path to resolve back to (repo, relPath).
          file: pathRelative(process.cwd(), file),
          line: v.line,
          message: `raw fetch() call: ${v.snippet}`,
        });
      }
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
