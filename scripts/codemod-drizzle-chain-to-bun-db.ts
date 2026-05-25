#!/usr/bin/env bun
// Codemod: convert drizzle chain APIs to bun-db helpers.
//
// Run: bun scripts/codemod-drizzle-chain-to-bun-db.ts [--apply]
//
// Patterns:
//   db.select().from(t)                                      → selectMany(db, t)
//   db.select().from(t).where(eq(t.col, v))                  → selectMany(db, t, { col: v })
//   db.select().from(t).where(and(eq(...), eq(...)))         → selectMany(db, t, { a, b })
//   db.select().from(t).where(...).limit(N)                  → selectMany(db, t, w, { limit: N })
//   db.select(<proj>).from(t).where(...)                     → asRawClient(db).unsafe(`SELECT … `) — flagged TODO
//   db.insert(t).values(v).returning()                       → insertOne(db, t, v)
//   db.insert(t).values(v)                                   → insertOne(db, t, v)
//   db.update(t).set(v).where(eq(...))                       → updateMany(db, t, v, { col: x })
//   db.update(t).set(v).where(eq(...)).returning()           → updateMany(db, t, v, { col: x })
//   db.delete(t).where(eq(...))                              → deleteMany(db, t, { col: x })
//   tx.execute(sql`…`)                                       → asRawClient(tx).unsafe(`…`, [params])
//   db.transaction(fn)                                       → db.begin(fn)
//
// Imports:
//   - drop `eq`, `and`, `or` from drizzle-orm imports
//   - if file ends up importing only types from drizzle-orm → keep the import
//   - if file still references `sql` from drizzle-orm → swap to "@cosmicdrift/kumiko-framework/db"
//   - auto-add bun-db helper imports as needed (selectMany, fetchOne, insertOne,
//     updateMany, deleteMany, asRawClient) — picks the right relative path for
//     packages/framework/src/** and the @-alias for packages/bundled-features/src/**.

import path from "node:path";
import {
  CallExpression,
  Node,
  Project,
  SyntaxKind,
  type SourceFile,
} from "ts-morph";

const APPLY = process.argv.includes("--apply");
const FILTER = process.argv.find((a) => a.startsWith("--file="))?.slice(7);

const ROOTS = [
  "packages/framework/src",
  "packages/bundled-features/src",
  "samples/recipes",
  "samples/apps",
];

const project = new Project({
  tsConfigFilePath: "tsconfig.json",
  skipAddingFilesFromTsConfig: true,
});
for (const root of ROOTS) project.addSourceFilesAtPaths(`${root}/**/*.ts`);

let touched = 0;
const summary = new Map<string, number>();

function bump(label: string): void {
  summary.set(label, (summary.get(label) ?? 0) + 1);
}

// --- helpers -------------------------------------------------------------

function isTableExpr(arg: Node): boolean {
  // Heuristic: identifier or a property-access; we don't reject anything
  // hard, the codemod is intentionally permissive — TS will flag misuses.
  return Node.isIdentifier(arg) || Node.isPropertyAccessExpression(arg);
}

// Extract a chain like `db.select().from(t).where(W).limit(N)` into pieces.
// Returns null if the chain doesn't match the drizzle select shape.
type SelectChain = {
  receiver: string;           // "db" / "tx" / "ctx.db.raw" — printed verbatim
  fromTable: string;          // text of the `from(...)` argument
  whereArg: string | null;    // text of the `where(...)` argument, or null
  limitArg: string | null;
  orderByArg: string | null;
  hasProjection: boolean;     // `db.select({col: t.col})` style
  outerNode: CallExpression;  // the outermost CallExpression we'll replace
};

function tryParseSelectChain(call: CallExpression): SelectChain | null {
  // Walk inward: outermost may be .limit(...), .orderBy(...), .where(...), .from(...), .select(...)
  let cur: Node = call;
  let limitArg: string | null = null;
  let orderByArg: string | null = null;
  let whereArg: string | null = null;
  let fromTable: string | null = null;
  let hasProjection = false;
  let receiver: string | null = null;

  while (Node.isCallExpression(cur)) {
    const expr = cur.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return null;
    const name = expr.getName();
    const args = cur.getArguments();
    if (name === "limit") {
      if (limitArg !== null) return null;
      if (args.length !== 1) return null;
      limitArg = args[0]!.getText();
    } else if (name === "orderBy") {
      if (orderByArg !== null) return null;
      orderByArg = args.map((a) => a.getText()).join(", ");
    } else if (name === "where") {
      if (whereArg !== null) return null;
      if (args.length !== 1) return null;
      whereArg = args[0]!.getText();
    } else if (name === "from") {
      if (fromTable !== null) return null;
      if (args.length !== 1) return null;
      fromTable = args[0]!.getText();
    } else if (name === "select") {
      if (args.length > 0) hasProjection = true;
      receiver = expr.getExpression().getText();
      return {
        receiver,
        fromTable: fromTable ?? "",
        whereArg,
        limitArg,
        orderByArg,
        hasProjection,
        outerNode: call,
      };
    } else {
      return null;
    }
    cur = expr.getExpression();
  }
  return null;
}

type InsertChain = {
  receiver: string;
  table: string;
  values: string;
  returning: boolean;
  outerNode: CallExpression;
};
function tryParseInsertChain(call: CallExpression): InsertChain | null {
  // .returning() | .values(v) | .insert(t)
  let cur: Node = call;
  let returning = false;
  let values: string | null = null;
  let table: string | null = null;
  let receiver: string | null = null;
  while (Node.isCallExpression(cur)) {
    const expr = cur.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return null;
    const name = expr.getName();
    const args = cur.getArguments();
    if (name === "returning") {
      if (returning) return null;
      returning = true;
    } else if (name === "values") {
      if (values !== null) return null;
      if (args.length !== 1) return null;
      values = args[0]!.getText();
    } else if (name === "insert") {
      if (args.length !== 1) return null;
      table = args[0]!.getText();
      receiver = expr.getExpression().getText();
      return { receiver, table, values: values ?? "{}", returning, outerNode: call };
    } else {
      return null;
    }
    cur = expr.getExpression();
  }
  return null;
}

type UpdateChain = {
  receiver: string;
  table: string;
  setValues: string;
  whereArg: string | null;
  returning: boolean;
  outerNode: CallExpression;
};
function tryParseUpdateChain(call: CallExpression): UpdateChain | null {
  let cur: Node = call;
  let returning = false;
  let whereArg: string | null = null;
  let setValues: string | null = null;
  let table: string | null = null;
  let receiver: string | null = null;
  while (Node.isCallExpression(cur)) {
    const expr = cur.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return null;
    const name = expr.getName();
    const args = cur.getArguments();
    if (name === "returning") returning = true;
    else if (name === "where") {
      if (whereArg !== null) return null;
      if (args.length !== 1) return null;
      whereArg = args[0]!.getText();
    } else if (name === "set") {
      if (setValues !== null) return null;
      if (args.length !== 1) return null;
      setValues = args[0]!.getText();
    } else if (name === "update") {
      if (args.length !== 1) return null;
      table = args[0]!.getText();
      receiver = expr.getExpression().getText();
      return {
        receiver,
        table,
        setValues: setValues ?? "{}",
        whereArg,
        returning,
        outerNode: call,
      };
    } else {
      return null;
    }
    cur = expr.getExpression();
  }
  return null;
}

type DeleteChain = {
  receiver: string;
  table: string;
  whereArg: string | null;
  outerNode: CallExpression;
};
function tryParseDeleteChain(call: CallExpression): DeleteChain | null {
  let cur: Node = call;
  let whereArg: string | null = null;
  let table: string | null = null;
  let receiver: string | null = null;
  while (Node.isCallExpression(cur)) {
    const expr = cur.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return null;
    const name = expr.getName();
    const args = cur.getArguments();
    if (name === "where") {
      if (whereArg !== null) return null;
      if (args.length !== 1) return null;
      whereArg = args[0]!.getText();
    } else if (name === "delete") {
      if (args.length !== 1) return null;
      table = args[0]!.getText();
      receiver = expr.getExpression().getText();
      return { receiver, table, whereArg, outerNode: call };
    } else {
      return null;
    }
    cur = expr.getExpression();
  }
  return null;
}

// --- WHERE conversion: drizzle eq()/and()/inArray()/isNull() → WhereObject --
//
// Returns `null` when the where-clause doesn't fit the WhereObject shape
// (sql-template, or-clauses, custom functions) — caller falls back to raw.
function whereExprToObjectLiteral(whereText: string | null): string | null {
  if (whereText === null) return null;
  // Strip newlines + collapse whitespace for easier regex.
  const text = whereText.replace(/\s+/g, " ").trim();

  // and(eq(t.a, v1), eq(t.b, v2), ...)
  const andMatch = text.match(/^and\((.*)\)$/s);
  if (andMatch) {
    const inner = splitTopLevelArgs(andMatch[1]!);
    const parts: string[] = [];
    for (const piece of inner) {
      const p = singleConditionToObjectPair(piece);
      if (p === null) return null;
      parts.push(p);
    }
    return `{ ${parts.join(", ")} }`;
  }
  const single = singleConditionToObjectPair(text);
  if (single === null) return null;
  return `{ ${single} }`;
}

function splitTopLevelArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter((x) => x.length > 0);
}

// "eq(t.col, value)"      → "col: value"
// "eq(t.col, value)"      with t.col → snakeFromCamel optional
// "inArray(t.col, arr)"   → "col: arr"
// "isNull(t.col)"         → "col: null"
// "gt(t.col, v)"          → 'col: { gt: v }'
// "ne(...)"               → 'col: { ne: v }'
// "lt", "lte", "gte"      → same operator-object pattern
function singleConditionToObjectPair(cond: string): string | null {
  const m = cond.match(/^(eq|inArray|isNull|gt|gte|lt|lte|ne|like)\((.*)\)$/s);
  if (!m) return null;
  const op = m[1]!;
  const args = splitTopLevelArgs(m[2]!);

  function colName(colExpr: string): string | null {
    // Patterns:
    //   t.foo
    //   table.foo
    //   sometable["foo"]
    //   sometable.bar.foo   (rare)
    const dotMatch = colExpr.match(/[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)$/);
    if (dotMatch) return dotMatch[1]!;
    const bracketMatch = colExpr.match(/\["([A-Za-z_$][\w$]*)"\]$/);
    if (bracketMatch) return bracketMatch[1]!;
    return null;
  }

  if (op === "isNull") {
    if (args.length !== 1) return null;
    const col = colName(args[0]!);
    if (!col) return null;
    return `${col}: null`;
  }
  if (op === "inArray") {
    if (args.length !== 2) return null;
    const col = colName(args[0]!);
    if (!col) return null;
    return `${col}: [...${args[1]}]`;
  }
  if (op === "eq") {
    if (args.length !== 2) return null;
    const col = colName(args[0]!);
    if (!col) return null;
    return `${col}: ${args[1]}`;
  }
  // Operator-objects
  if (args.length !== 2) return null;
  const col = colName(args[0]!);
  if (!col) return null;
  return `${col}: { ${op}: ${args[1]} }`;
}

// --- the main rewrite pass ----------------------------------------------

const BUN_DB_NEEDED = new Set([
  "selectMany",
  "fetchOne",
  "insertOne",
  "updateMany",
  "deleteMany",
  "asRawClient",
]);

// Collect rewrite intents (start, end, replacement) in a single pass; apply
// in reverse source-order so we never touch a node that's about to move.
type Edit = { start: number; end: number; replacement: string; helpers: string[] };

function collectEdits(sf: SourceFile): Edit[] {
  const edits: Edit[] = [];
  const claimed: Array<{ start: number; end: number }> = [];
  const isInside = (start: number, end: number): boolean =>
    claimed.some((c) => start >= c.start && end <= c.end);
  const claim = (e: Edit): void => {
    edits.push(e);
    claimed.push({ start: e.start, end: e.end });
  };

  // Walk outermost-first by sorting CallExpressions by depth ascending.
  // Document order already yields "outer before inner" when the outer's start
  // is earlier — but for chains the OUTER ends LATER. Sort by end-offset DESC
  // so we visit the widest call first.
  const calls = sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .sort((a, b) => b.getEnd() - a.getEnd() || a.getStart() - b.getStart());

  // Methods we know how to terminate a chain at (or that are themselves
  // chain steps). If a parent call is NOT in this set, the codemod refuses
  // to convert — it would otherwise leave dangling .onConflictDoUpdate /
  // .for("update") / .innerJoin etc. attached to a Promise.
  const KNOWN_CHAIN = new Set([
    "select",
    "from",
    "where",
    "limit",
    "orderBy",
    "offset",
    "insert",
    "values",
    "update",
    "set",
    "delete",
    "returning",
  ]);

  // Heuristic: only treat a chain as "drizzle-DB" when the receiver text
  // matches one of these DB-like patterns. Prevents the codemod from
  // mangling Map/Set/array `.delete()` and `.select()` calls.
  const DB_RECEIVER = /(^|[.[])(db|tx|client|raw|sql|tdb|testDb|stackDb)\d*(\b|$)/i;
  function isDbReceiver(receiver: string): boolean {
    return DB_RECEIVER.test(receiver);
  }
  // Special case: receivers ending in `tdb` (TenantDb instances) get the
  // member-call form (`tdb.selectMany(...)`) instead of `selectMany(tdb,
  // ...)` so the auto-tenant-scoping semantics are preserved.
  function isTenantDbReceiver(receiver: string): boolean {
    return /(^|[.])tdb\d*$|TenantDb$|tDb$|ctx\.db$/i.test(receiver.trim());
  }

  function isWrappedByUnknownChain(call: CallExpression): boolean {
    const parent = call.getParent();
    if (parent && Node.isPropertyAccessExpression(parent)) {
      if (!KNOWN_CHAIN.has(parent.getName())) return true;
    }
    return false;
  }

  for (const call of calls) {
    const start = call.getStart();
    const end = call.getEnd();
    if (isInside(start, end)) continue;
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) continue;
    const callName = expr.getName();


    // Refuse to convert if the parent chain method is unknown to the codemod
    // (drizzle .onConflictDoUpdate, .onConflictDoNothing, .for("update"),
    // .innerJoin, .leftJoin, ...). Author handles those by hand.
    if (isWrappedByUnknownChain(call)) continue;

    // SELECT chain — only process at the OUTERMOST chain call. If our
    // parent is also a chain method we let the parent's iteration handle it.
    if (callName === "limit" || callName === "orderBy" || callName === "where" || callName === "from") {
      const parent = call.getParent();
      if (parent && Node.isPropertyAccessExpression(parent)) {
        const pn = parent.getName();
        if (["limit", "orderBy", "where", "from", "select"].includes(pn)) continue;
      }
      const parsed = tryParseSelectChain(call);
      if (parsed && !parsed.hasProjection && isDbReceiver(parsed.receiver)) {
        const wo = whereExprToObjectLiteral(parsed.whereArg);
        if (parsed.whereArg === null || wo !== null) {
          const opts: string[] = [];
          if (parsed.limitArg !== null) opts.push(`limit: ${parsed.limitArg}`);
          if (parsed.orderByArg !== null) {
            const m = parsed.orderByArg.match(/^(desc|asc)\((.+)\)$/s);
            if (m) {
              const obDir = m[1] === "desc" ? "desc" : "asc";
              const obCol = (m[2]!.match(/\.([A-Za-z_$][\w$]*)$/) ||
                m[2]!.match(/\["([A-Za-z_$][\w$]*)"\]$/))?.[1];
              if (obCol) opts.push(`orderBy: { col: "${obCol}", direction: "${obDir}" }`);
            }
          }
          if (isTenantDbReceiver(parsed.receiver)) {
            const memberArgs: string[] = [parsed.fromTable];
            if (parsed.whereArg !== null) memberArgs.push(wo!);
            if (opts.length > 0) memberArgs.push(`{ ${opts.join(", ")} }`);
            claim({
              start,
              end,
              replacement: `${parsed.receiver}.selectMany(${memberArgs.join(", ")})`,
              helpers: [],
            });
          } else {
            const args: string[] = [parsed.receiver, parsed.fromTable];
            if (parsed.whereArg !== null) args.push(wo!);
            if (opts.length > 0) args.push(`{ ${opts.join(", ")} }`);
            claim({
              start,
              end,
              replacement: `selectMany(${args.join(", ")})`,
              helpers: ["selectMany"],
            });
          }
          bump("select→selectMany");
          continue;
        }
      }
    }

    // INSERT chain
    if (callName === "returning" || callName === "values") {
      const parsed = tryParseInsertChain(call);
      if (parsed && isDbReceiver(parsed.receiver)) {
        if (isTenantDbReceiver(parsed.receiver)) {
          claim({
            start,
            end,
            replacement: `${parsed.receiver}.insertOne(${parsed.table}, ${parsed.values})`,
            helpers: [],
          });
        } else {
          claim({
            start,
            end,
            replacement: `insertOne(${parsed.receiver}, ${parsed.table}, ${parsed.values})`,
            helpers: ["insertOne"],
          });
        }
        bump("insert→insertOne");
        continue;
      }
    }

    // UPDATE chain (may end in .set / .where / .returning)
    if (callName === "set" || callName === "where" || callName === "returning") {
      const upd = tryParseUpdateChain(call);
      if (upd && upd.whereArg !== null && isDbReceiver(upd.receiver)) {
        const wo = whereExprToObjectLiteral(upd.whereArg);
        if (wo !== null) {
          if (isTenantDbReceiver(upd.receiver)) {
            claim({
              start,
              end,
              replacement: `${upd.receiver}.updateMany(${upd.table}, ${upd.setValues}, ${wo})`,
              helpers: [],
            });
          } else {
            claim({
              start,
              end,
              replacement: `updateMany(${upd.receiver}, ${upd.table}, ${upd.setValues}, ${wo})`,
              helpers: ["updateMany"],
            });
          }
          bump("update→updateMany");
          continue;
        }
      }
    }

    // DELETE chain ends in .where(...)
    if (callName === "where") {
      const del = tryParseDeleteChain(call);
      if (del && del.whereArg !== null && isDbReceiver(del.receiver)) {
        const wo = whereExprToObjectLiteral(del.whereArg);
        if (wo !== null) {
          if (isTenantDbReceiver(del.receiver)) {
            claim({
              start,
              end,
              replacement: `${del.receiver}.deleteMany(${del.table}, ${wo})`,
              helpers: [],
            });
          } else {
            claim({
              start,
              end,
              replacement: `deleteMany(${del.receiver}, ${del.table}, ${wo})`,
              helpers: ["deleteMany"],
            });
          }
          bump("delete→deleteMany");
          continue;
        }
      }
    }

    // Bare db.delete(t) — full-table wipe (test fixtures). Emit raw SQL
    // against table.tableName; SchemaTable exposes that as a top-level prop.
    if (callName === "delete" && call.getArguments().length === 1) {
      const tableArg = call.getArguments()[0]!;
      const dbExpr = expr.getExpression().getText();
      if (isDbReceiver(dbExpr)) {
        claim({
          start,
          end,
          replacement: `asRawClient(${dbExpr}).unsafe(\`DELETE FROM "$\{${tableArg.getText()}.tableName}"\`)`,
          helpers: ["asRawClient"],
        });
        bump("delete(t)→asRawClient.unsafe");
        continue;
      }
    }

    // db.execute("string literal") → asRawClient(db).unsafe("string literal")
    if (callName === "execute" && call.getArguments().length === 1) {
      const arg0 = call.getArguments()[0]!;
      const dbExpr = expr.getExpression().getText();
      if (
        isDbReceiver(dbExpr) &&
        (Node.isStringLiteral(arg0) || Node.isNoSubstitutionTemplateLiteral(arg0))
      ) {
        claim({
          start,
          end,
          replacement: `asRawClient(${dbExpr}).unsafe(${arg0.getText()})`,
          helpers: ["asRawClient"],
        });
        bump("execute(string)→asRawClient.unsafe");
        continue;
      }
    }

    // db.execute(sql`SELECT ... ${var} ...`) → asRawClient(db).unsafe(`SELECT ... $N ...`, [params])
    if (callName === "execute" && call.getArguments().length === 1) {
      const arg = call.getArguments()[0]!;
      const dbExpr = expr.getExpression().getText();
      if (
        isDbReceiver(dbExpr) &&
        Node.isTaggedTemplateExpression(arg) &&
        Node.isIdentifier(arg.getTag()) &&
        arg.getTag().getText() === "sql"
      ) {
        const tpl = arg.getTemplate();
        // Collect placeholders + params
        const parts: string[] = [];
        const params: string[] = [];
        if (Node.isNoSubstitutionTemplateLiteral(tpl)) {
          parts.push(tpl.getLiteralText());
        } else if (Node.isTemplateExpression(tpl)) {
          parts.push(tpl.getHead().getLiteralText());
          for (const span of tpl.getTemplateSpans()) {
            params.push(span.getExpression().getText());
            parts.push(`$${params.length}`);
            parts.push(span.getLiteral().getLiteralText());
          }
        }
        const sqlText = parts.join("");
        const escaped = "`" + sqlText.replace(/`/g, "\\`") + "`";
        const paramsArg = params.length > 0 ? `, [${params.join(", ")}]` : "";
        const dbExpr = expr.getExpression().getText();
        claim({
          start,
          end,
          replacement: `asRawClient(${dbExpr}).unsafe(${escaped}${paramsArg})`,
          helpers: ["asRawClient"],
        });
        bump("execute(sql`…`)→asRawClient.unsafe");
        continue;
      }
    }

    // .transaction → .begin (postgres-js naming). Rewrite ONLY the property-
    // access piece, not the whole call — the args + callback shape stay.
    if (callName === "transaction" && call.getArguments().length === 1) {
      const accessStart = expr.getStart();
      const accessEnd = expr.getEnd();
      claim({
        start: accessStart,
        end: accessEnd,
        replacement: `${expr.getExpression().getText()}.begin`,
        helpers: [],
      });
      bump(".transaction→.begin");
      continue;
    }
  }

  return edits;
}

function rewriteFile(sf: SourceFile): boolean {
  const filePath = sf.getFilePath();
  if (filePath.endsWith(".d.ts") || filePath.includes("/dist/")) return false;
  if (
    filePath.includes("/bun-db/") ||
    filePath.endsWith("/db/dialect.ts") ||
    filePath.endsWith("/db/tenant-db.ts") ||
    filePath.endsWith("/db/table-builder.ts") ||
    filePath.endsWith("/db/event-store-executor.ts") ||
    filePath.includes("/scripts/codemod-")
  ) {
    return false;
  }

  const edits = collectEdits(sf);
  if (edits.length === 0) return false;

  // Apply edits to the raw text in reverse source-order so positions stay valid.
  let text = sf.getFullText();
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) {
    text = text.slice(0, e.start) + e.replacement + text.slice(e.end);
  }
  sf.replaceWithText(text);

  const helpersUsed = new Set<string>();
  for (const e of edits) for (const h of e.helpers) helpersUsed.add(h);
  const mutated = true;

  if (mutated) {
    // --- Imports cleanup --------------------------------------------------
    // Drop eq/and/inArray/isNull/gt/gte/lt/lte/ne/like/or/asc/desc from drizzle-orm.
    // If only `sql` remains, swap path to "@cosmicdrift/kumiko-framework/db".
    const SKIPPED = new Set([
      "eq",
      "and",
      "or",
      "inArray",
      "isNull",
      "gt",
      "gte",
      "lt",
      "lte",
      "ne",
      "like",
      "asc",
      "desc",
    ]);
    for (const imp of sf.getImportDeclarations()) {
      const mod = imp.getModuleSpecifierValue();
      if (mod === "drizzle-orm") {
        const named = imp.getNamedImports();
        for (const ni of named) if (SKIPPED.has(ni.getName())) ni.remove();
        const stillNamed = imp.getNamedImports();
        if (stillNamed.length === 0 && !imp.getDefaultImport()) {
          imp.remove();
        } else {
          // Move remaining (probably `sql`) to native dialect.
          imp.setModuleSpecifier("@cosmicdrift/kumiko-framework/db");
        }
      }
    }

    // Add bun-db helpers if any were introduced.
    if (helpersUsed.size > 0) {
      const helpers = [...helpersUsed].sort();
      // Pick the relative or alias path depending on file location.
      const rel = path.relative(path.dirname(filePath), path.resolve("packages/framework/src/bun-db/query"));
      const isFramework = filePath.includes("/packages/framework/src/");
      const moduleSpec = isFramework
        ? rel.startsWith(".") ? rel : `./${rel}`
        : "@cosmicdrift/kumiko-framework/bun-db";
      // Check existing import already targets the alias / a relative bun-db.
      const existing = sf.getImportDeclaration(
        (d) => {
          const m = d.getModuleSpecifierValue();
          return (
            m === "@cosmicdrift/kumiko-framework/bun-db" ||
            m.endsWith("/bun-db/query") ||
            m.endsWith("/bun-db/index") ||
            m.endsWith("/bun-db")
          );
        },
      );
      if (existing) {
        const existingNames = new Set(existing.getNamedImports().map((n) => n.getName()));
        for (const h of helpers) {
          if (!existingNames.has(h)) existing.addNamedImport(h);
        }
      } else {
        sf.addImportDeclaration({
          moduleSpecifier: moduleSpec,
          namedImports: helpers.map((name) => ({ name })),
        });
      }
    }

    touched++;
    return true;
  }
  return false;
}

// --- driver --------------------------------------------------------------

for (const sf of project.getSourceFiles()) {
  if (FILTER && !sf.getFilePath().includes(FILTER)) continue;
  if (rewriteFile(sf)) {
    console.log(sf.getFilePath().replace(`${process.cwd()}/`, ""));
  }
}

console.log("");
console.log(`Touched ${touched} files. Summary:`);
for (const [k, v] of [...summary.entries()].sort()) {
  console.log(`  ${k}: ${v}`);
}

if (APPLY) {
  await project.save();
  console.log("");
  console.log("Saved.");
} else {
  console.log("");
  console.log("Dry-run (use --apply to write).");
}
