#!/usr/bin/env bun
/**
 * Guard: tests do not write event-sourced rows past the event store.
 * Flags updateRows/deleteRows from kumiko-testing/helpers and seedRow on an entity table
 * the file builds itself unless they carry a projectionOnly reason, raw INSERT/UPDATE/DELETE
 * SQL on read_ tables, kumiko_events or such an entity table outside a projection's apply,
 * and TRUNCATE of a projection without kumiko_events: they change the projection only, so
 * the event log drifts from it and a rebuild undoes the write. It also flags row writes on
 * eventsTable.
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
import {
  findEventsTableWrites,
  findRawSqlWrites,
  findSeedRowOnEntityTables,
  hasProjectionOnlyReason,
} from "./_lib/test-es-raw-writes";

// Test helpers next to the specs and Playwright dirs sit outside the manifests' testGlobs.
const SCAN: ScanSpec = {
  scope: "tests",
  extensions: ["ts", "tsx"],
  extraGlobs: [
    "src/**/__tests__/**/*.{ts,tsx}",
    "bin/**/__tests__/**/*.{ts,tsx}",
    "bin/**/*.{test,integration}.{ts,tsx}",
    "e2e/**/*.{ts,tsx}",
    "packages/*/e2e/**/*.{ts,tsx}",
    "packages/*/src/e2e/**/*.{ts,tsx}",
    "samples/e2e/**/*.{ts,tsx}",
    "samples/recipes/*/e2e/**/*.{ts,tsx}",
    "samples/apps/*/e2e/**/*.{ts,tsx}",
  ],
};

const ALLOWLIST: readonly RegExp[] = [
  // Home of the helpers.
  /^packages\/testing\/src\//,
  // The guard's own fixtures and the Biome plugin fixtures of the same rule.
  /^packages\/guards\/src\/__tests__\//,
  /^packages\/framework\/src\/presets\/__tests__\//,
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
  // Corrupt, drift or poison a projection row on purpose to exercise the read, repair or skip path.
  /^packages\/bundled-features\/src\/auth-mfa\/__tests__\/reencrypt-job\.integration\.test\.ts$/,
  /^packages\/bundled-features\/src\/config\/__tests__\/config\.integration\.test\.ts$/,
  /^packages\/bundled-features\/src\/custom-fields\/__tests__\/custom-fields\.integration\.test\.ts$/,
  /^packages\/bundled-features\/src\/custom-fields\/__tests__\/field-access\.integration\.test\.ts$/,
  /^packages\/bundled-features\/src\/inbound-mail-foundation\/__tests__\/inbound-mail-foundation\.integration\.test\.ts$/,
  /^packages\/framework\/src\/db\/__tests__\/event-store-executor\.integration\.test\.ts$/,
  /^packages\/framework\/src\/db\/__tests__\/event-store-executor-write-verbs\.integration\.test\.ts$/,
  /^packages\/framework\/src\/event-store\/__tests__\/backfill-pii\.integration\.test\.ts$/,
  /^packages\/framework\/src\/pipeline\/__tests__\/search-consumer-named-events\.integration\.test\.ts$/,
  /^packages\/framework\/src\/search\/__tests__\/search-pii-derived-index\.integration\.test\.ts$/,
  // Seed an event-less legacy row that the code under test must adopt or upcast.
  /^packages\/framework\/src\/__tests__\/reference-data\.integration\.test\.ts$/,
  /^packages\/framework\/src\/pipeline\/__tests__\/load-aggregate-query\.integration\.test\.ts$/,
  // Backdate timestamps that no command can set, to drive retention and cleanup crons.
  /^packages\/bundled-features\/src\/custom-fields\/__tests__\/retention\.integration\.test\.ts$/,
  /^packages\/bundled-features\/src\/form-draft\/__tests__\/cleanup\.integration\.test\.ts$/,
  /^packages\/bundled-features\/src\/form-draft\/__tests__\/feature-optional-config\.integration\.test\.ts$/,
  /^packages\/server-runtime\/src\/__tests__\/bundled\/tier-engine-resolver\.integration\.test\.ts$/,
  /^samples\/recipes\/public-share-token\/src\/__tests__\/feature\.integration\.test\.ts$/,
  // App user-data delete hooks and probes that stand in for app code deleting its own rows.
  /^packages\/bundled-features\/src\/custom-fields\/__tests__\/user-data-rights\.integration\.test\.ts$/,
  /^packages\/bundled-features\/src\/crypto-shredding\/__tests__\/forget-subject-record\.integration\.test\.ts$/,
  /^packages\/bundled-features\/src\/user-data-rights\/__tests__\/forget-cleanup-search-purge-ordering\.integration\.test\.ts$/,
  // Rebuild scenarios wipe the projection while the events stay.
  /^packages\/bundled-features\/src\/jobs\/__tests__\/projection-rebuild-job\.integration\.test\.ts$/,
  /^packages\/framework\/src\/pipeline\/__tests__\/projection-rebuild\.integration\.test\.ts$/,
  // Deletes rows between pages or batches to simulate concurrent removal for the pager and reindex.
  /^packages\/framework\/src\/db\/__tests__\/event-store-executor-list\.integration\.test\.ts$/,
  /^packages\/framework\/src\/search\/__tests__\/reindex-entity\.integration\.test\.ts$/,
  // Plants projection rows without events because detecting them is the behavior under test.
  /^packages\/framework\/src\/db\/__tests__\/assert-no-unreachable-live-rows\.integration\.test\.ts$/,
  // Primitive db tests of the write lock, inserts, codecs and migrations below the executor.
  /^packages\/framework\/src\/db\/__tests__\/executor-managed-write-lock\.integration\.test\.ts$/,
  /^packages\/framework\/src\/db\/__tests__\/multi-row-insert\.integration\.test\.ts$/,
  /^packages\/framework\/src\/db\/__tests__\/number-field-fractional\.integration\.test\.ts$/,
  /^packages\/framework\/src\/db\/__tests__\/query\/write-brand\.test\.ts$/,
  /^packages\/framework\/src\/db\/__tests__\/schema-migration\.integration\.test\.ts$/,
  /^packages\/framework\/src\/db\/__tests__\/source-shadow-create\.integration\.test\.ts$/,
  // A hook writes a marker row through its TenantDb, which the event-store helpers do not take.
  /^packages\/bundled-features\/src\/feature-toggles\/__tests__\/feature-toggles\.integration\.test\.ts$/,
];

const BYPASS_NAMES: ReadonlySet<string> = new Set(["updateRows", "deleteRows"]);
const SEED_ROW_NAMES: ReadonlySet<string> = new Set(["seedRow"]);
const TESTING_HELPERS_RE =
  /^@cosmicdrift\/kumiko-testing\/helpers$|(^|\/)testing\/src\/helpers(\/|$)/;
const MESSAGE =
  "updateRows/deleteRows bypass the event store: use the real command, seedUser, " +
  "updateRowViaEventStore/deleteRowViaEventStore, or updateMany/deleteMany on a Writable table; " +
  "a deliberate projection-only state passes { projectionOnly: reason }";

type HelperBindings = {
  readonly wanted: ReadonlySet<string>;
  readonly names: Set<string>;
  readonly namespaces: Set<string>;
};

function helperBindings(sourceFile: SourceFile, wanted: ReadonlySet<string>): HelperBindings {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const decl of sourceFile.getImportDeclarations()) {
    if (!TESTING_HELPERS_RE.test(decl.getModuleSpecifierValue())) continue;
    for (const spec of decl.getNamedImports()) {
      if (wanted.has(spec.getName())) names.add(spec.getAliasNode()?.getText() ?? spec.getName());
    }
    const namespace = decl.getNamespaceImport();
    if (namespace) namespaces.add(namespace.getText());
  }
  return { wanted, names, namespaces };
}

function isHelperCallee(callee: Node, bindings: HelperBindings): boolean {
  if (Node.isIdentifier(callee)) return bindings.names.has(callee.getText());
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const target = callee.getExpression();
  return (
    bindings.wanted.has(callee.getName()) &&
    Node.isIdentifier(target) &&
    bindings.namespaces.has(target.getText())
  );
}

function collect(sourceFile: SourceFile, roots: readonly RepoRoot[]): GuardViolation[] {
  const file = relFromRepoRoot(sourceFile.getFilePath(), roots);
  if (ALLOWLIST.some((re) => re.test(file))) return [];
  const bypass = helperBindings(sourceFile, BYPASS_NAMES);
  const seedRow = helperBindings(sourceFile, SEED_ROW_NAMES);
  const importsBypass = bypass.names.size > 0 || bypass.namespaces.size > 0;
  const bypassCalls = importsBypass
    ? sourceFile
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter(
          (call) => isHelperCallee(call.getExpression(), bypass) && !hasProjectionOnlyReason(call),
        )
        .map((call) => ({ line: call.getStartLineNumber(), message: MESSAGE }))
    : [];
  return [
    ...bypassCalls,
    ...findSeedRowOnEntityTables(sourceFile, (callee) => isHelperCallee(callee, seedRow)),
    ...findEventsTableWrites(sourceFile),
    ...findRawSqlWrites(sourceFile),
  ].map((finding) => ({ file, ...finding }));
}

export const guard: AstGuard = {
  name: "Test-ES-Row-Writes Guard",
  scan: SCAN,
  hint:
    "Change event-sourced rows through the real command, seedUser({...}), seedRowViaEventStore or " +
    "updateRowViaEventStore/deleteRowViaEventStore, reset them with resetTestTables plus eventsTable; " +
    "use updateMany/deleteMany for non-event-sourced tables. A state no event can produce (legacy row, " +
    "lost read table, corrupt ciphertext, stale version) goes through seedRow/updateRows/deleteRows " +
    "with { projectionOnly: reason }.",
  run(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    return { violations: files.flatMap((sf) => collect(sf, roots)) };
  },
};

if (import.meta.main) runStandalone(guard);
