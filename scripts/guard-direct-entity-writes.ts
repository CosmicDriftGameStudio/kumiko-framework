/**
 * Guard: verbietet direkte DB-Writes auf Tabellen, die als ES-Entity-
 * Projection registriert sind. Jeder write auf so einer Tabelle MUSS
 * durch den event-store-executor oder eine inline-projection laufen —
 * sonst driftet die Projection-Row am events-Stream vorbei.
 *
 * Erkennung in zwei Phasen:
 *
 *   1. **ES-Tables sammeln.** Alle `createEventStoreExecutor(<tableExpr>,
 *      <entity>, ...)`-Aufrufe im Repo scannen; `<tableExpr>` ist der Name
 *      der Projection-Table (als Identifier). Das gibt die Set von Tabellen,
 *      die unter ES-Regie stehen.
 *
 *   2. **Direct-Writes finden.** Alle Call-Expressions `<receiver>.insert(
 *      <tableIdent>)` / `.update(...)` / `.delete(...)` scannen; wenn
 *      `<tableIdent>` in der ES-Set ist, prüfen ob der Aufruf erlaubt ist:
 *
 *      - Receiver `tx` / `trx` → INLINE-Projection-Apply (OK, tx ist das
 *        TX-Argument aus r.projection({ apply: (event, tx) => ... })).
 *      - Test- bzw. Testing-Helper-File → OK (Fixture-Setup wie
 *        seedTenantMembership geht bewusst durch executor, oder tests
 *        resetten state direkt mit .delete()).
 *      - Framework-Internal-File (event-store-executor.ts selbst) → OK.
 *      - Alles andere → BLOCK.
 *
 * Der Guard ist ein Komplement zu Pre-ES-Patterns: der fängt "alte APIs
 * kommen zurück", dieser hier fängt "neue Feature schreibt am ES vorbei".
 *
 * Usage:
 *   yarn tsx scripts/guard-direct-entity-writes.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, type SourceFile, SyntaxKind } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_GLOBS = [
  "packages/framework/src/**/*.ts",
  "packages/bundled-features/src/**/*.ts",
  "samples/**/*.ts",
];

// Files die NICHT geprüft werden. Tests + Testing-Helpers + event-store-
// executor selbst + dist.
const EXCLUDE = /(^|\/)(dist|node_modules)\/|__tests__\/|\.test\.ts$|\.integration\.ts$|\/testing(\.ts|\/)|\/event-store-executor\.ts$|scripts\/guard-direct-entity-writes\.ts$/;

// Receivers die bei direct-writes erlaubt sind. `tx` / `trx` sind die
// TX-Parameter aus r.projection({ apply: (event, tx) => ... }) — das ist
// exakt der inline-projection-Pfad, der legitim ist. `handle` wird
// gelegentlich als TX-Variable-Name genutzt.
const ALLOWED_RECEIVERS = new Set(["tx", "trx", "handle"]);

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

function collectEsTables(project: Project): Set<TableId> {
  const tables = new Set<TableId>();
  for (const sf of project.getSourceFiles()) {
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

type Violation = {
  file: string;
  line: number;
  receiver: string;
  op: "insert" | "update" | "delete";
  table: string;
  snippet: string;
};

function scanDirectWrites(
  sf: SourceFile,
  esTables: ReadonlySet<TableId>,
): Omit<Violation, "file">[] {
  const out: Omit<Violation, "file">[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const methodName = pa.getName();
    if (methodName !== "insert" && methodName !== "update" && methodName !== "delete") continue;

    const args = call.getArguments();
    const tableArg = args[0];
    if (!tableArg || tableArg.getKind() !== SyntaxKind.Identifier) continue;
    const tableName = tableArg.getText();
    const did = declIdOf(tableArg.asKindOrThrow(SyntaxKind.Identifier));
    if (!did || !esTables.has(did)) continue;

    // Walk the receiver chain down to its leftmost identifier. For `db.insert`
    // that's `db`; for `ctx.db.insert` that's `ctx`; for `tx.insert` that's
    // `tx`. We check that leftmost identifier against the allowlist.
    let receiver = pa.getExpression();
    while (receiver.getKind() === SyntaxKind.PropertyAccessExpression) {
      receiver = receiver.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getExpression();
    }
    const receiverName = receiver.getText();
    if (ALLOWED_RECEIVERS.has(receiverName)) continue;

    out.push({
      line: call.getStartLineNumber(),
      receiver: receiverName,
      op: methodName as "insert" | "update" | "delete",
      table: tableName,
      snippet: call.getText().slice(0, 120),
    });
  }
  return out;
}

async function main(): Promise<void> {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/framework/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  for (const glob of SCAN_GLOBS) {
    project.addSourceFilesAtPaths(path.join(ROOT, glob));
  }

  const esTables = collectEsTables(project);
  if (esTables.size === 0) {
    console.error(
      "  BLOCKED: guard found no createEventStoreExecutor calls — scan is probably misconfigured.",
    );
    process.exit(1);
  }

  const violations: Violation[] = [];
  let scannedFiles = 0;

  for (const sf of project.getSourceFiles()) {
    const file = sf.getFilePath();
    if (EXCLUDE.test(file)) continue;
    scannedFiles++;

    for (const hit of scanDirectWrites(sf, esTables)) {
      violations.push({
        file: path.relative(ROOT, file),
        ...hit,
      });
    }
  }

  console.log(
    `Direct-Entity-Writes Guard: ${scannedFiles} Dateien, ${esTables.size} ES-Tabellen, ${violations.length} Verstöße.`,
  );

  if (violations.length === 0) {
    console.log("  Keine direkten Writes auf ES-Projection-Tabellen.");
    return;
  }

  console.error(
    `\n  BLOCKED: ${violations.length} direkte Writes auf ES-Projection-Tabellen.\n`,
  );
  console.error(
    "  Jede dieser Stellen umgeht den event-store-executor — die Projection driftet dann\n" +
      "  am events-Stream vorbei. Korrektur: executor.create/update/delete nutzen, oder den\n" +
      "  Write in eine inline-projection (r.projection) verschieben (tx-receiver ist erlaubt).\n",
  );
  for (const v of violations) {
    console.error(
      `    ${v.file}:${v.line}  ${v.receiver}.${v.op}(${v.table})  —  ${v.snippet}`,
    );
  }
  console.error("");
  process.exit(1);
}

main();
