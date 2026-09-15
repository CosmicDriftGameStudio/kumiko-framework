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
 *      b) All `r.entity(<name>, <entityDef>)` registrations: every `r.entity`
 *         is a rebuildable implicit projection. The corresponding Drizzle
 *         table is linked via the SHARED entity-def identifier, NOT via a
 *         name string — `r.entity("user-session", ent)` and
 *         `buildEntityTable("user_session", ent)` disagree on the name
 *         (dash vs. underscore) but share the `ent` symbol. Plus an explicit
 *         `{ table }` override. Tables that are NOT statically resolvable
 *         are skipped (a miss is preferable to a false block).
 *
 *   2. **Find direct writes.** Two forms:
 *      - Method form `<receiver>.insert(<tableIdent>)` / `.update` / `.delete`.
 *      - Function form `insertOne|updateMany|deleteMany|...(<db>, <tableIdent>,
 *        ...)` from `@cosmicdrift/kumiko-framework/bun-db` (table = arg[1]) —
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
  type Identifier,
  type Node,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
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

// bun-db function helpers with signature `(db, table, ...)` — table is
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

// Identity of a table declaration: absolute file path + identifier name.
// Text-only names collide across samples (currencies-global.invoiceTable vs.
// beammycar.invoiceTable would look the same); resolving to the underlying
// declaration disambiguates them.
type TableId = string; // "${filePath}::${name}"

function declIdOf(id: import("ts-morph").Identifier): TableId | undefined {
  const symbol = id.getSymbol();
  if (!symbol) return undefined;
  const decls = symbol.getDeclarations();
  if (decls.length === 0) return undefined;
  // Param-only symbols are factory pass-throughs — skip.
  if (decls.every((d) => d.getKind() === SyntaxKind.Parameter)) return undefined;
  const first = decls[0];
  if (!first) return undefined;
  return `${first.getSourceFile().getFilePath()}::${id.getText()}`;
}

export function collectEsTables(files: readonly SourceFile[]): Set<TableId> {
  const tables = new Set<TableId>();
  for (const sf of files) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (expr.getText() !== "createEventStoreExecutor") continue;
      const tableArg = call.getArguments()[0];
      if (!tableArg || tableArg.getKind() !== SyntaxKind.Identifier) continue;
      const id = tableArg.asKindOrThrow(SyntaxKind.Identifier);

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

// Tables registered via `r.entity(name, entityDef)` as a rebuildable implicit
// projection, linked entity→table via the shared entity-def symbol (see header), not by name string.
export function collectEntityProjectionTables(files: readonly SourceFile[]): Set<TableId> {
  const rebuildableEntities = new Set<TableId>();
  const tables = new Set<TableId>();

  // Pass 1: entity-def decls that r.entity makes rebuildable (+ {table} override).
  for (const sf of files) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
      if (expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName() !== "entity") continue;
      const args = call.getArguments();
      if (!args[0] || args[0].getKind() !== SyntaxKind.StringLiteral) continue;

      const entityArg = args[1];
      if (entityArg?.getKind() === SyntaxKind.Identifier) {
        const did = declIdOf(entityArg.asKindOrThrow(SyntaxKind.Identifier));
        if (did) rebuildableEntities.add(did);
      }

      const opts = args[2];
      if (opts?.getKind() === SyntaxKind.ObjectLiteralExpression) {
        const tableProp = opts
          .asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
          .getProperty("table");
        if (tableProp?.getKind() === SyntaxKind.PropertyAssignment) {
          const init = tableProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
          if (init?.getKind() === SyntaxKind.Identifier) {
            const did = declIdOf(init.asKindOrThrow(SyntaxKind.Identifier));
            if (did) tables.add(did);
          }
        }
      }
    }
  }

  // Pass 2: `const xTable = buildEntityTable(<name>, <entityDef>)` where entityDef
  // is in the rebuildable set → xTable is a rebuildable entity table.
  for (const sf of files) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getText() !== "buildEntityTable") continue;
      const entityArg = call.getArguments()[1];
      if (entityArg?.getKind() !== SyntaxKind.Identifier) continue;
      const entityDid = declIdOf(entityArg.asKindOrThrow(SyntaxKind.Identifier));
      if (!entityDid || !rebuildableEntities.has(entityDid)) continue;

      const varDecl = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      const nameNode = varDecl?.getNameNode();
      if (nameNode?.getKind() !== SyntaxKind.Identifier) continue;
      const did = declIdOf(nameNode.asKindOrThrow(SyntaxKind.Identifier));
      if (did) tables.add(did);
    }
  }

  return tables;
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
  reason: "non-tx-receiver" | "tx-outside-apply";
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
// bun-db function `updateMany(db, table, ...)`. undefined for non-writes or
// when the table arg isn't a plain identifier (not resolvable → skip, never
// a false block).
function resolveWrite(
  call: CallExpression,
): { tableArg: Identifier; receiver: Node; op: "insert" | "update" | "delete" } | undefined {
  const expr = call.getExpression();
  const args = call.getArguments();

  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    const pa = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const m = pa.getName();
    if (m !== "insert" && m !== "update" && m !== "delete") return undefined;
    if (args[0]?.getKind() !== SyntaxKind.Identifier) return undefined;
    return {
      tableArg: args[0].asKindOrThrow(SyntaxKind.Identifier),
      receiver: pa.getExpression(),
      op: m,
    };
  }

  if (expr.getKind() === SyntaxKind.Identifier) {
    const op = FN_WRITE_HELPERS.get(expr.getText());
    if (!op) return undefined;
    if (!args[0] || args[1]?.getKind() !== SyntaxKind.Identifier) return undefined;
    return {
      tableArg: args[1].asKindOrThrow(SyntaxKind.Identifier),
      receiver: args[0],
      op,
    };
  }

  return undefined;
}

export function scanDirectWrites(
  sf: SourceFile,
  esTables: ReadonlySet<TableId>,
): Omit<Violation, "file">[] {
  const out: Omit<Violation, "file">[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const w = resolveWrite(call);
    if (!w) continue;

    const did = declIdOf(w.tableArg);
    if (!did || !esTables.has(did)) continue;

    // Walk the receiver chain down to its leftmost identifier. For `db.insert`
    // that's `db`; for `ctx.db.raw` (function-form arg0) that's `ctx`; for
    // `tx` that's `tx`. Checked against the TX-receiver-Set.
    let receiver: Node = w.receiver;
    while (receiver.getKind() === SyntaxKind.PropertyAccessExpression) {
      receiver = receiver.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression();
    }
    const receiverName = receiver.getText();

    if (TX_RECEIVER_NAMES.has(receiverName)) {
      // A tx receiver is only legitimate when the write actually sits
      // inside a projection-apply callback. A sub-tx pattern like
      // `db.transaction(async (tx) => { tx.update(esTable)...})` falls
      // through here because there's no apply-property/defineApply wrapper.
      if (isInsideProjectionApply(call)) continue;
      out.push({
        line: call.getStartLineNumber(),
        receiver: receiverName,
        op: w.op,
        table: w.tableArg.getText(),
        snippet: call.getText().slice(0, 120),
        reason: "tx-outside-apply",
      });
      continue;
    }

    out.push({
      line: call.getStartLineNumber(),
      receiver: receiverName,
      op: w.op,
      table: w.tableArg.getText(),
      snippet: call.getText().slice(0, 120),
      reason: "non-tx-receiver",
    });
  }
  return out;
}

export const guard: AstGuard = {
  name: "Direct-Entity-Writes Guard",
  scan: SCAN,
  security: true,
  run(files) {
    // Merge both collections BEFORE the empty-set check — otherwise a repo
    // that only uses r.entity (no createEventStoreExecutor anymore) would
    // skip every scan: the canary violation fires falsely, and writes on
    // entity tables go undetected.
    const esTables = new Set<TableId>([
      ...collectEsTables(files),
      ...collectEntityProjectionTables(files),
    ]);
    if (esTables.size === 0) {
      return {
        violations: [
          {
            file: "<scan>",
            line: 0,
            message:
              "BLOCKED: guard found no createEventStoreExecutor or r.entity projection tables — scan is probably misconfigured.",
          },
        ],
      };
    }

    const violations: Array<{ file: string; line: number; message: string }> = [];

    for (const sf of files) {
      const file = sf.getFilePath();
      if (EXCLUDE.test(file)) continue;

      for (const hit of scanDirectWrites(sf, esTables)) {
        violations.push({
          file: path.relative(ROOT, file),
          line: hit.line,
          message: `[${hit.reason}] ${hit.receiver}.${hit.op}(${hit.table}) — ${hit.snippet}`,
        });
      }
    }

    return { violations };
  },
};

// Run only when invoked as a script — tests import the helpers without
// triggering the scan + console output.
if (import.meta.main) runStandalone(guard);
