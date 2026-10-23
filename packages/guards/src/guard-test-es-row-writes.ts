#!/usr/bin/env bun
/**
 * Guard: framework tests do not write event-sourced rows through the seed bypass.
 * Flags calls to updateRows/deleteRows imported from kumiko-testing/helpers: they
 * change the projection only, so the event log drifts from it and a rebuild undoes
 * the write.
 *
 * Usage:
 *   bun packages/guards/src/guard-test-es-row-writes.ts
 */
import type { SourceFile } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  type GuardViolation,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

// Framework repo only: the consumer repos still call updateRows/deleteRows in their
// tests, so rolling this out there needs a migration of those call sites first.
const SCAN: ScanSpec = { scope: "tests", extensions: ["ts"], kinds: ["framework"] };

const ALLOWLIST: readonly RegExp[] = [
  // Home of the helpers.
  /^packages\/testing\/src\//,
  // The guard's own fixtures.
  /^packages\/guards\/src\/__tests__\//,
  // Simulates event-less legacy rows for the backfill.
  /^packages\/bundled-features\/src\/user-data-rights\/__tests__\/read-users-rebuild-survives-lifecycle\.integration\.test\.ts$/,
  // Stands in for the handover move, which itself writes directly.
  /^packages\/bundled-features\/src\/files-tenant-data\/__tests__\/hooks\.integration\.test\.ts$/,
  // Corrupts ciphertext on the projection to exercise the skip path.
  /^packages\/bundled-features\/src\/inbound-mail-foundation\/__tests__\/watch-supervisor\.integration\.test\.ts$/,
  // Primitive test of the TenantDb where-merge.
  /^packages\/framework\/src\/db\/__tests__\/tenant-db-where-merge\.integration\.test\.ts$/,
  // The entity cache is invalidated on the helper path, so only a projection-only write leaves it stale.
  /^packages\/framework\/src\/__tests__\/full-stack\.integration\.test\.ts$/,
];

const BYPASS_NAMES: ReadonlySet<string> = new Set(["updateRows", "deleteRows"]);
const TESTING_HELPERS_RE =
  /^@cosmicdrift\/kumiko-testing\/helpers$|(^|\/)testing\/src\/helpers(\/|$)/;
const MESSAGE =
  "updateRows/deleteRows bypass the event store: use the real command, seedUser, " +
  "updateRowViaEventStore/deleteRowViaEventStore, or updateMany/deleteMany on a Writable table";

type BypassBindings = { readonly names: Set<string>; readonly namespaces: Set<string> };

function bypassBindings(sourceFile: SourceFile): BypassBindings {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const decl of sourceFile.getImportDeclarations()) {
    if (!TESTING_HELPERS_RE.test(decl.getModuleSpecifierValue())) continue;
    for (const spec of decl.getNamedImports()) {
      if (BYPASS_NAMES.has(spec.getName()))
        names.add(spec.getAliasNode()?.getText() ?? spec.getName());
    }
    const namespace = decl.getNamespaceImport();
    if (namespace) namespaces.add(namespace.getText());
  }
  return { names, namespaces };
}

function isBypassCallee(callee: Node, bindings: BypassBindings): boolean {
  if (Node.isIdentifier(callee)) return bindings.names.has(callee.getText());
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const target = callee.getExpression();
  return (
    BYPASS_NAMES.has(callee.getName()) &&
    Node.isIdentifier(target) &&
    bindings.namespaces.has(target.getText())
  );
}

function collect(sourceFile: SourceFile, roots: readonly RepoRoot[]): GuardViolation[] {
  const file = relFromRepoRoot(sourceFile.getFilePath(), roots);
  if (ALLOWLIST.some((re) => re.test(file))) return [];
  const bindings = bypassBindings(sourceFile);
  if (bindings.names.size === 0 && bindings.namespaces.size === 0) return [];
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => isBypassCallee(call.getExpression(), bindings))
    .map((call) => ({ file, line: call.getStartLineNumber(), message: MESSAGE }));
}

export const guard: AstGuard = {
  name: "Test-ES-Row-Writes Guard",
  scan: SCAN,
  hint:
    "Change event-sourced rows through the real command, seedUser({...}), or " +
    "updateRowViaEventStore/deleteRowViaEventStore; use updateMany/deleteMany for non-event-sourced tables.",
  run(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    return { violations: files.flatMap((sf) => collect(sf, roots)) };
  },
};

if (import.meta.main) runStandalone(guard);
