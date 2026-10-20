#!/usr/bin/env bun
/**
 * Guard: forbids direct DB writes on tables registered as ES-entity
 * projections. Every write to such a table MUST go through the
 * event-store-executor or an inline projection — otherwise the projection
 * row drifts away from the events stream.
 *
 * Detection in two phases:
 *
 *   1. **Collect ES tables.** Two sources:
 *      a) All `createEventStoreExecutor(<tableExpr>, <entity>, ...)` calls;
 *         `<tableExpr>` is the projection table (identifier).
 *      b) All `r.entity({ name, ...<entityDef> })` registrations: every
 *         `r.entity` is a rebuildable implicit projection. The corresponding
 *         Drizzle table is linked via the SHARED entity-def identifier, NOT via
 *         a name string — `r.entity({ name: "user-session", ...ent })` and
 *         `buildEntityTable("user_session", ent)` disagree on the name
 *         (dash vs. underscore) but share the `ent` symbol. Plus an explicit
 *         `backingTable` override. Tables that are NOT statically resolvable
 *         are skipped (a miss is preferable to a false block).
 *      c) Tables of external packages (node_modules, workspace links), read from the
 *         `kumiko-es-tables.json` catalog each published package ships; a package whose
 *         sources live in the checked repo must keep that catalog current (checked here,
 *         rewritten with `--write-baseline --guard=<name>`).
 *      d) `r.projection({ table })` tables: event-fed read models, only the apply may write.
 *
 *   2. **Find direct writes.** Two forms:
 *      - Method form `<receiver>.insert(<tableIdent>)` / `.update` / `.delete`.
 *      - Function form `insertOne|updateMany|deleteMany|...(<db>, <tableIdent>,
 *        ...)` from `@cosmicdrift/kumiko-framework/db` (table = arg[1]) —
 *        exactly the path that created the sessions-instance bug
 *        (`updateMany(ctx.db.raw, userSessionTable, ...)` without a
 *        lifecycle event).
 *      Once `<tableIdent>` is in the ES set, check whether the call is allowed:
 *
 *      - Receiver `tx` / `trx` → inline projection apply (OK, tx is the
 *        tx argument from `r.projection({ apply: (event, tx) => ... })`).
 *      - Test or testing-helper file → OK (fixture setup like
 *        seedTenantMembership deliberately goes through the executor, or
 *        tests reset state directly with `.delete()`).
 *      - Framework-internal file (event-store-executor.ts itself) → OK.
 *      - Everything else → BLOCK.
 *
 * This guard complements pre-ES patterns: that one catches "old APIs coming
 * back", this one catches "a new feature writes past the ES".
 *
 * Usage:
 *   bun guards/guard-direct-entity-writes.ts
 */

import * as path from "node:path";
import {
  type CallExpression,
  type FileSystemHost,
  type Identifier,
  Node,
  type ObjectLiteralExpression,
  type Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import {
  ALL_REPO_KINDS,
  type AstGuard,
  isExternalSourcePath,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  kinds: ALL_REPO_KINDS,
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

// Files that are NOT checked. Tests + testing helpers + the event-store
// executor itself + dist.
const EXCLUDE =
  /(^|\/)(dist|node_modules)\/|__tests__\/|\.test\.ts$|\.integration\.ts$|\/testing(\.ts|\/)|\/event-store-executor\.ts$|scripts\/guard-direct-entity-writes\.ts$/;

// Receivers that are *context-dependent* allowed for direct writes.
// `tx` / `trx` / `handle` are the tx parameters from
// `r.projection({ apply: (event, tx) => ... })` OR `defineApply((event,
// tx) => ...)` — both are the inline-projection path, which is legitimate.
//
// **Context-dependent** because the same receiver name can also appear in
// `db.transaction(async (tx) => {...})` — that is an ordinary sub-tx in
// production code and MUST be blocked, otherwise it bypasses the ES
// requirement (precedent: run-forget-cleanup.ts did exactly that). The
// guard checks per hit whether the enclosing function is actually a
// projection apply.
const TX_RECEIVER_NAMES = new Set(["tx", "trx", "handle"]);

// db/query function helpers with signature `(db, table, ...)` — table is
// always arg[1]. A direct write on an ES table goes through these just as
// often as through the Drizzle method form. Maps to the coarse op bucket
// for the violation message.
const FN_WRITE_HELPERS = new Map<string, "insert" | "update" | "delete">([
  ["insertOne", "insert"],
  ["insertMany", "insert"],
  ["upsertOnConflict", "insert"],
  ["upsertByPk", "insert"],
  ["updateMany", "update"],
  ["deleteMany", "delete"],
  ["deleteManyBatched", "delete"],
]);

// `table as EntityTableMeta`, `(table)`, `table!`, `<T>table`, `table satisfies T` all name the same table.
export function unwrapTableExpression(node: Node): Node {
  let current = node;
  while (
    Node.isAsExpression(current) ||
    Node.isSatisfiesExpression(current) ||
    Node.isParenthesizedExpression(current) ||
    Node.isNonNullExpression(current) ||
    Node.isTypeAssertion(current)
  ) {
    current = current.getExpression();
  }
  return current;
}

// Identity of a table declaration: absolute file path + identifier name.
// Text-only names collide across samples (currencies-global.invoiceTable vs.
// beammycar.invoiceTable would look the same); resolving to the underlying
// declaration disambiguates them.
type TableId = string; // "${filePath}::${name}"

function declIdOf(id: Identifier): TableId | undefined {
  const symbol = id.getSymbol();
  if (!symbol) return undefined;
  // An imported identifier's own declaration is the ImportSpecifier; follow the alias
  // chain (barrels, renames) so the ID matches the one built at the definition.
  const resolved = symbol.isAlias() ? (symbol.getAliasedSymbol() ?? symbol) : symbol;
  const decls = resolved.getDeclarations();
  if (decls.length === 0) return undefined;
  // Param-only symbols are factory pass-throughs — skip.
  if (decls.every((d) => d.getKind() === SyntaxKind.Parameter)) return undefined;
  const first = decls[0];
  if (!first) return undefined;
  const name = Node.hasName(first) ? first.getName() : id.getText();
  return `${first.getSourceFile().getFilePath()}::${name}`;
}

export function collectEsTables(files: readonly SourceFile[]): Set<TableId> {
  const tables = new Set<TableId>();
  for (const sf of files) {
    if (!sf.getFullText().includes("createEventStoreExecutor")) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (expr.getText() !== "createEventStoreExecutor") continue;
      const firstArg = call.getArguments()[0];
      const id = firstArg && unwrapTableExpression(firstArg).asKind(SyntaxKind.Identifier);
      if (!id) continue;

      // Repo convention: projection-tables follow `<name>Table`. Secondary
      // filter that catches factory-of-factory pass-throughs even if
      // symbol resolution somehow succeeds on a `table` parameter.
      if (!/^[a-z]\w*Table$/.test(id.getText())) continue;

      const did = declIdOf(id);
      if (did) tables.add(did);
    }
  }
  return tables;
}

function unwrappedIdentifierDeclId(node: Node | undefined): TableId | undefined {
  const identifier = node && unwrapTableExpression(node).asKind(SyntaxKind.Identifier);
  return identifier ? declIdOf(identifier) : undefined;
}

// The `backingTable` override of `r.entity({ name, ...def, backingTable })`.
function entityTableOverrideId(definition: ObjectLiteralExpression): TableId | undefined {
  const tableProp = definition.getProperty("backingTable");
  if (tableProp?.getKind() !== SyntaxKind.PropertyAssignment) return undefined;
  return unwrappedIdentifierDeclId(
    tableProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer(),
  );
}

// The entity definition spread into `r.entity({ name, ...def })`.
function spreadEntityDefinitionId(definition: ObjectLiteralExpression): TableId | undefined {
  for (const property of definition.getProperties()) {
    if (property.getKind() !== SyntaxKind.SpreadAssignment) continue;
    const spreadId = unwrappedIdentifierDeclId(
      property.asKindOrThrow(SyntaxKind.SpreadAssignment).getExpression(),
    );
    if (spreadId) return spreadId;
  }
  return undefined;
}

type EntityRegistration = {
  readonly entityDid: TableId | undefined;
  readonly overrideTableDid: TableId | undefined;
};

function entityRegistrationOf(call: CallExpression): EntityRegistration | undefined {
  const expr = call.getExpression();
  if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return undefined;
  if (expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName() !== "entity") {
    return undefined;
  }
  const definition = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  const nameProp = definition?.getProperty("name");
  if (!definition || nameProp?.getKind() !== SyntaxKind.PropertyAssignment) return undefined;
  const nameValue = nameProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
  if (nameValue?.getKind() !== SyntaxKind.StringLiteral) return undefined;
  return {
    entityDid: spreadEntityDefinitionId(definition),
    overrideTableDid: entityTableOverrideId(definition),
  };
}

// `const xTable = buildEntityTable(<name>, <entityDef>)` with a rebuildable entityDef.
function rebuildableEntityTableDeclId(
  call: CallExpression,
  rebuildableEntities: ReadonlySet<TableId>,
): TableId | undefined {
  if (call.getExpression().getText() !== "buildEntityTable") return undefined;
  const entityDid = unwrappedIdentifierDeclId(call.getArguments()[1]);
  if (!entityDid || !rebuildableEntities.has(entityDid)) return undefined;
  const nameNode = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getNameNode();
  if (nameNode?.getKind() !== SyntaxKind.Identifier) return undefined;
  return declIdOf(nameNode.asKindOrThrow(SyntaxKind.Identifier));
}

const ENTITY_METHOD_ACCESS = /\.\s*entity\b/;

// Tables registered via `r.entity({ name, ...entityDef })` as a rebuildable implicit
// projection, linked entity→table via the shared entity-def symbol (see header), not by name string.
export function collectEntityProjectionTables(files: readonly SourceFile[]): Set<TableId> {
  const rebuildableEntities = new Set<TableId>();
  const tables = new Set<TableId>();

  // Pass 1: entity-def decls that r.entity makes rebuildable (+ {table} override).
  for (const sf of files) {
    if (!ENTITY_METHOD_ACCESS.test(sf.getFullText())) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const registration = entityRegistrationOf(call);
      if (!registration) continue;
      if (registration.entityDid) rebuildableEntities.add(registration.entityDid);
      if (registration.overrideTableDid) tables.add(registration.overrideTableDid);
    }
  }

  // Pass 2: `const xTable = buildEntityTable(<name>, <entityDef>)` where entityDef
  // is in the rebuildable set → xTable is a rebuildable entity table.
  for (const sf of files) {
    if (!sf.getFullText().includes("buildEntityTable")) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const did = rebuildableEntityTableDeclId(call, rebuildableEntities);
      if (did) tables.add(did);
    }
  }

  return tables;
}

const PROJECTION_METHOD_ACCESS = /\.\s*projection\b/;

// The `table` of `r.projection({ table, apply })`: an event-fed read model, so only its apply
// (tx receiver) may write it. Shorthand `{ table }` is a name-only reference to the same symbol.
export function collectProjectionTables(files: readonly SourceFile[]): Set<TableId> {
  const tables = new Set<TableId>();
  for (const sf of files) {
    if (!PROJECTION_METHOD_ACCESS.test(sf.getFullText())) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
      if (callee?.getName() !== "projection") continue;
      const definition = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
      const property = definition?.getProperty("table");
      const identifier =
        property?.asKind(SyntaxKind.ShorthandPropertyAssignment)?.getNameNode() ??
        unwrapTableExpression(
          property?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer() ?? call,
        ).asKind(SyntaxKind.Identifier);
      const did = identifier && declIdOf(identifier);
      if (did) tables.add(did);
    }
  }
  return tables;
}

function collectScopeEsTables(files: readonly SourceFile[]): Set<TableId> {
  return new Set<TableId>([
    ...collectEsTables(files),
    ...collectEntityProjectionTables(files),
    ...collectProjectionTables(files),
  ]);
}

type Violation = {
  file: string;
  line: number;
  receiver: string;
  op: "insert" | "update" | "delete";
  table: string;
  snippet: string;
  /**
   * Which check fired:
   *   - "non-tx-receiver"  → receiver not in TX_RECEIVER_NAMES.
   *   - "tx-outside-apply" → tx receiver, but the enclosing fn is not a
   *                          projection apply (e.g. a db.transaction sub-tx
   *                          in production code).
   */
  kind: "non-tx-receiver" | "tx-outside-apply";
};

/**
 * A tx receiver is legitimate only inside an inline projection apply —
 * `r.projection({ apply: (event, tx) => ... })` (incl. a nested per-event apply) or `defineApply((event, tx) => ...)` — never a bare `db.transaction(...)`.
 */
function isInsideProjectionApply(callNode: Node): boolean {
  let cursor: Node | undefined = callNode.getParent();
  while (cursor) {
    const kind = cursor.getKind();
    if (kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.FunctionExpression) {
      const parent = cursor.getParent();
      if (!parent) return false;

      // Pattern 3: defineApply(<this fn>)
      if (parent.getKind() === SyntaxKind.CallExpression) {
        const callExpr = parent.asKindOrThrow(SyntaxKind.CallExpression);
        if (callExpr.getExpression().getText() === "defineApply") return true;
        // Other call context (e.g. db.transaction(<this fn>)) → not a
        // projection apply; keep walking up in case one is further out
        // (rare, defensive).
      }

      // Pattern 1+2: PropertyAssignment in Object-Literal
      if (parent.getKind() === SyntaxKind.PropertyAssignment) {
        const propAssign = parent.asKindOrThrow(SyntaxKind.PropertyAssignment);
        // Direct: { apply: <this fn> }
        if (propAssign.getName() === "apply") return true;
        // Nested: { apply: { [EVENT]: <this fn> } }
        const objLit = propAssign.getParent();
        if (objLit?.getKind() === SyntaxKind.ObjectLiteralExpression) {
          const objParent = objLit.getParent();
          if (objParent?.getKind() === SyntaxKind.PropertyAssignment) {
            const outer = objParent.asKindOrThrow(SyntaxKind.PropertyAssignment);
            if (outer.getName() === "apply") return true;
          }
        }
      }
    }
    cursor = cursor.getParent();
  }
  return false;
}

// Extracts (table identifier, db/receiver expression, op) from a write
// call — both forms: the Drizzle method `<recv>.insert(table)` and the
// db/query function `updateMany(db, table, ...)`. Casts around the table arg are
// unwrapped; undefined for non-writes or when the table arg is still no plain
// identifier (computed tables are not resolvable → skip, never a false block).
function resolveWrite(
  call: CallExpression,
): { tableArg: Identifier; receiver: Node; op: "insert" | "update" | "delete" } | undefined {
  const expr = call.getExpression();
  const args = call.getArguments();

  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    const pa = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const m = pa.getName();
    if (m !== "insert" && m !== "update" && m !== "delete") return undefined;
    const tableArg = args[0] && unwrapTableExpression(args[0]).asKind(SyntaxKind.Identifier);
    if (!tableArg) return undefined;
    return { tableArg, receiver: pa.getExpression(), op: m };
  }

  if (expr.getKind() === SyntaxKind.Identifier) {
    const op = FN_WRITE_HELPERS.get(expr.getText());
    if (!op) return undefined;
    const tableArg = args[1] && unwrapTableExpression(args[1]).asKind(SyntaxKind.Identifier);
    if (!args[0] || !tableArg) return undefined;
    return { tableArg, receiver: args[0], op };
  }

  return undefined;
}

// Callee names whose result is a table definition: `const xTable = <builder>(...)`.
const TABLE_BUILDER_NAMES: ReadonlySet<string> = new Set([
  "pgTable",
  "table",
  "buildEntityTable",
  "defineUnmanagedTable",
  "deriveEntityTableMeta",
]);

function isTableDeclaration(identifier: Identifier): boolean {
  const symbol = identifier.getSymbol();
  const resolved = symbol?.getAliasedSymbol() ?? symbol;
  return (resolved?.getDeclarations() ?? []).some((decl) => {
    if (decl.getKind() !== SyntaxKind.VariableDeclaration) return false;
    const init = decl.asKindOrThrow(SyntaxKind.VariableDeclaration).getInitializer();
    if (init?.getKind() !== SyntaxKind.CallExpression) return false;
    const callee = init.asKindOrThrow(SyntaxKind.CallExpression).getExpression();
    const calleeName =
      callee.getKind() === SyntaxKind.PropertyAccessExpression
        ? callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName()
        : callee.getText();
    return TABLE_BUILDER_NAMES.has(calleeName);
  });
}

// A write whose table argument resolves to a real table declaration — keeps
// `map.delete(key)` / `set.delete(id)` from counting as table writes.
function isTableWriteCall(call: CallExpression): boolean {
  const write = resolveWrite(call);
  return (
    write !== undefined &&
    declIdOf(write.tableArg) !== undefined &&
    isTableDeclaration(write.tableArg)
  );
}

function isTableBuilderCall(call: CallExpression): boolean {
  const callee = call.getExpression();
  const calleeName =
    callee.getKind() === SyntaxKind.PropertyAccessExpression
      ? callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName()
      : callee.getText();
  return TABLE_BUILDER_NAMES.has(calleeName);
}

// Table declarations count as evidence too: when write resolution breaks
// structurally (`tables.userTable`, re-exports) no write is recognised, but the
// declarations are still visible, so the empty-set canary must not go green.
function hasAnyTableWriteOrDeclaration(files: readonly SourceFile[]): boolean {
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (isTableWriteCall(call) || isTableBuilderCall(call)) return true;
    }
  }
  return false;
}

// A TableId ends in `::<identifier text>`, so a table argument whose text is no ES table name
// can never match; filtering on the name avoids a symbol lookup (TS program build) per call.
function tableNamesOf(tableIds: ReadonlySet<TableId>): Set<string> {
  return new Set([...tableIds].map((tableId) => tableId.slice(tableId.lastIndexOf("::") + 2)));
}

// Local names an import can give a table in this file (`import { a as b }` -> b). Syntactic,
// so a rename or barrel re-export never hides an ES table from the name prefilter.
function importedBindingNames(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const declaration of sf.getImportDeclarations()) {
    const defaultName = declaration.getDefaultImport()?.getText();
    if (defaultName) names.add(defaultName);
    for (const specifier of declaration.getNamedImports()) {
      names.add(specifier.getAliasNode()?.getText() ?? specifier.getName());
    }
  }
  return names;
}

const ES_TABLE_CATALOG_FILE = "kumiko-es-tables.json";

type CatalogEntry = { readonly module: string; readonly export: string };

function tableIdFilePath(tableId: TableId): string {
  return tableId.slice(0, tableId.lastIndexOf("::"));
}

function tableIdName(tableId: TableId): string {
  return tableId.slice(tableId.lastIndexOf("::") + 2);
}

function packageRootOf(host: FileSystemHost, filePath: string): string | undefined {
  let dir = path.dirname(filePath);
  while (dir !== path.dirname(dir)) {
    if (host.fileExistsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return undefined;
}

// Source (`src/x.ts`, workspace link) and published (`dist/x.d.ts`) layouts must yield one key.
function moduleOf(packageRoot: string, filePath: string): string {
  return path
    .relative(packageRoot, filePath)
    .split(path.sep)
    .join("/")
    .replace(/^(src|dist)\//, "")
    .replace(/\.d\.ts$|\.(ts|tsx|js)$/, "");
}

function catalogKey(module: string, exportName: string): string {
  return `${module}::${exportName}`;
}

function isCatalogEntry(value: unknown): value is CatalogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "module" in value &&
    "export" in value &&
    typeof value.module === "string" &&
    typeof value.export === "string"
  );
}

function parseCatalog(text: string): CatalogEntry[] | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) && parsed.every(isCatalogEntry) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readCatalogKeys(host: FileSystemHost, packageRoot: string): Set<string> {
  const catalogPath = path.join(packageRoot, ES_TABLE_CATALOG_FILE);
  if (!host.fileExistsSync(catalogPath)) return new Set();
  const entries = parseCatalog(host.readFileSync(catalogPath)) ?? [];
  return new Set(entries.map((entry) => catalogKey(entry.module, entry.export)));
}

export type ExternalEsTables = { has(tableId: TableId): boolean };

// A published package ships `kumiko-es-tables.json` (module + export of its ES tables), because
// its sources are not on disk in a consumer (only dist/*.d.ts). Missing catalog: no ES tables.
export function createExternalEsTables(project: Project): ExternalEsTables {
  const host = project.getFileSystem();
  const keysByPackageRoot = new Map<string, ReadonlySet<string>>();
  return {
    has(tableId) {
      const filePath = tableIdFilePath(tableId);
      const root = packageRootOf(host, filePath);
      if (root === undefined) return false;
      let keys = keysByPackageRoot.get(root);
      if (!keys) {
        keys = readCatalogKeys(host, root);
        keysByPackageRoot.set(root, keys);
      }
      return keys.has(catalogKey(moduleOf(root, filePath), tableIdName(tableId)));
    },
  };
}

function isPublishedPackage(host: FileSystemHost, packageRoot: string): boolean {
  try {
    const manifest: unknown = JSON.parse(host.readFileSync(path.join(packageRoot, "package.json")));
    return !(
      typeof manifest === "object" &&
      manifest !== null &&
      "private" in manifest &&
      manifest.private === true
    );
  } catch {
    return false;
  }
}

// Owner side: the exported scope ES tables of every published package, grouped by package root.
function deriveCatalogs(
  files: readonly SourceFile[],
  esTables: ReadonlySet<TableId>,
): Map<string, CatalogEntry[]> {
  const catalogs = new Map<string, CatalogEntry[]>();
  const firstFile = files[0];
  if (!firstFile) return catalogs;
  const project = firstFile.getProject();
  const host = project.getFileSystem();
  const scopePaths = new Set<string>(files.map((file) => file.getFilePath()));
  const publishedByRoot = new Map<string, boolean>();
  for (const tableId of esTables) {
    const filePath = tableIdFilePath(tableId);
    if (!scopePaths.has(filePath) || EXCLUDE.test(filePath)) continue;
    const name = tableIdName(tableId);
    if (!project.getSourceFile(filePath)?.getVariableDeclaration(name)?.isExported()) continue;
    const root = packageRootOf(host, filePath);
    if (root === undefined) continue;
    let published = publishedByRoot.get(root);
    if (published === undefined) {
      published = isPublishedPackage(host, root);
      publishedByRoot.set(root, published);
    }
    if (!published) continue;
    const entries = catalogs.get(root) ?? [];
    entries.push({ module: moduleOf(root, filePath), export: name });
    catalogs.set(root, entries);
  }
  for (const [root, entries] of catalogs) {
    entries.sort(
      (a, b) => a.module.localeCompare(b.module, "en") || a.export.localeCompare(b.export, "en"),
    );
    catalogs.set(root, [
      ...new Map(entries.map((e) => [catalogKey(e.module, e.export), e])).values(),
    ]);
  }
  return catalogs;
}

const REWRITE_CATALOGS_COMMAND =
  'bun packages/guards/src/run-guards.ts --write-baseline --guard="Direct-Entity-Writes Guard"';

// Published packages whose catalog exists on disk although they define no ES table any more.
function publishedRootsWithCatalog(files: readonly SourceFile[]): Set<string> {
  const roots = new Set<string>();
  const firstFile = files[0];
  if (!firstFile) return roots;
  const host = firstFile.getProject().getFileSystem();
  const rootByDir = new Map<string, string | undefined>();
  for (const sf of files) {
    const dir = path.dirname(sf.getFilePath());
    if (!rootByDir.has(dir)) rootByDir.set(dir, packageRootOf(host, dir));
    const root = rootByDir.get(dir);
    if (root !== undefined && host.fileExistsSync(path.join(root, ES_TABLE_CATALOG_FILE))) {
      roots.add(root);
    }
  }
  return roots;
}

function catalogViolations(
  files: readonly SourceFile[],
  esTables: ReadonlySet<TableId>,
): { file: string; line: number; message: string; neverFrozen: boolean }[] {
  const firstFile = files[0];
  if (!firstFile) return [];
  const host = firstFile.getProject().getFileSystem();
  const expected = deriveCatalogs(files, esTables);
  const roots = new Set([...expected.keys(), ...publishedRootsWithCatalog(files)]);
  const violations: { file: string; line: number; message: string; neverFrozen: boolean }[] = [];
  for (const root of roots) {
    const wanted = new Set((expected.get(root) ?? []).map((e) => catalogKey(e.module, e.export)));
    const actual = readCatalogKeys(host, root);
    const missing = [...wanted].filter((key) => !actual.has(key));
    const surplus = [...actual].filter((key) => !wanted.has(key));
    if (missing.length === 0 && surplus.length === 0) continue;
    const catalogPath = path.join(root, ES_TABLE_CATALOG_FILE);
    const detail = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : "",
      surplus.length > 0 ? `surplus: ${surplus.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    violations.push({
      file: path.relative(ROOT, catalogPath),
      line: 0,
      message: `ES table catalog out of date (${detail}). Rewrite it: ${REWRITE_CATALOGS_COMMAND}`,
      neverFrozen: true,
    });
  }
  return violations;
}

function writeCatalogs(files: readonly SourceFile[], esTables: ReadonlySet<TableId>): void {
  const firstFile = files[0];
  if (!firstFile) throw new Error("No scanned files: refusing to rewrite ES table catalogs");
  const host = firstFile.getProject().getFileSystem();
  const expected = deriveCatalogs(files, esTables);
  for (const root of publishedRootsWithCatalog(files)) {
    if (!expected.has(root)) host.deleteSync(path.join(root, ES_TABLE_CATALOG_FILE));
  }
  for (const [root, entries] of expected) {
    host.writeFileSync(
      path.join(root, ES_TABLE_CATALOG_FILE),
      `${JSON.stringify(entries, null, 2)}\n`,
    );
  }
}

export function scanDirectWrites(
  sf: SourceFile,
  esTables: ReadonlySet<TableId>,
  externalEsTables: ExternalEsTables = createExternalEsTables(sf.getProject()),
): Omit<Violation, "file">[] {
  const out: Omit<Violation, "file">[] = [];
  // Superset of every name a write may use for an ES table: definition names plus import bindings.
  const candidateNames = new Set([...tableNamesOf(esTables), ...importedBindingNames(sf)]);
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const w = resolveWrite(call);
    if (!w) continue;
    if (!candidateNames.has(w.tableArg.getText())) continue;

    // Walk the receiver chain down to its leftmost identifier. For `db.insert`
    // that's `db`; for `ctx.db.raw` (function-form arg0) that's `ctx`; for
    // `tx` that's `tx`. Checked against the TX-receiver-Set.
    let receiver: Node = w.receiver;
    while (receiver.getKind() === SyntaxKind.PropertyAccessExpression) {
      receiver = receiver.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression();
    }
    const receiverName = receiver.getText();

    const did = declIdOf(w.tableArg);
    if (!did) continue;
    if (!esTables.has(did)) {
      if (!isExternalSourcePath(tableIdFilePath(did)) || !externalEsTables.has(did)) continue;
    }

    if (TX_RECEIVER_NAMES.has(receiverName)) {
      // A tx receiver is only legitimate when the write actually sits
      // inside a projection-apply callback. A sub-tx pattern like
      // `db.transaction(async (tx) => { tx.update(esTable)...})` falls
      // through here because there's no apply-property/defineApply wrapper.
      if (isInsideProjectionApply(call)) continue;
      out.push({
        line: call.getStartLineNumber(),
        receiver: w.receiver.getText(),
        op: w.op,
        table: w.tableArg.getText(),
        snippet: call.getText().slice(0, 120),
        kind: "tx-outside-apply",
      });
      continue;
    }

    out.push({
      line: call.getStartLineNumber(),
      receiver: w.receiver.getText(),
      op: w.op,
      table: w.tableArg.getText(),
      snippet: call.getText().slice(0, 120),
      kind: "non-tx-receiver",
    });
  }
  return out;
}

export const guard: AstGuard = {
  name: "Direct-Entity-Writes Guard",
  scan: SCAN,
  security: true,
  hint:
    "Write ES-entity tables through the entity write handlers / event-store executor or inside an r.projection apply (tx receiver); a direct insert/update/delete lets the projection row drift from the event stream. " +
    "For a BLOCKED scan, check that the scan still covers the files declaring r.entity / createEventStoreExecutor.",
  run(files) {
    // Merge all collections BEFORE the empty-set check — otherwise a repo that only uses r.entity
    // would skip every scan: the canary fires falsely and writes on entity tables go undetected.
    const esTables = collectScopeEsTables(files);
    if (esTables.size === 0) {
      // An empty set means either the repo has no event store at all, or the
      // scan lost the ES definitions while table writes are still present.
      if (!hasAnyTableWriteOrDeclaration(files)) return { violations: [] };
      return {
        violations: [
          {
            file: "<scan>",
            line: 0,
            message:
              "BLOCKED: guard found table writes or table declarations but no createEventStoreExecutor or r.entity projection tables — scan is probably misconfigured.",
          },
        ],
      };
    }

    const violations: Array<{
      file: string;
      line: number;
      message: string;
      neverFrozen?: boolean;
    }> = catalogViolations(files, esTables);

    const firstFile = files[0];
    const externalEsTables = firstFile
      ? createExternalEsTables(firstFile.getProject())
      : { has: () => false };

    for (const sf of files) {
      const file = sf.getFilePath();
      if (EXCLUDE.test(file)) continue;

      for (const hit of scanDirectWrites(sf, esTables, externalEsTables)) {
        violations.push({
          file: path.relative(ROOT, file),
          line: hit.line,
          message: `[${hit.kind}] ${hit.receiver}.${hit.op}(${hit.table}) — ${hit.snippet}`,
        });
      }
    }

    return { violations };
  },
  writeBaseline(files) {
    writeCatalogs(files, collectScopeEsTables(files));
  },
};

// Run only when invoked as a script — tests import the helpers without
// triggering the scan + console output.
if (import.meta.main) runStandalone(guard);
