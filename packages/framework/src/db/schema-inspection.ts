import type { DbConnection, DbTx } from "./connection";

type UnsafeFn = (s: string, p?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;

// The raw postgres `.unsafe(sql, params)` escape hatch lives at different
// depths depending on whether `db` is a DbConnection, a Drizzle session, or
// the bare client. Resolve it once for the low-level inspection queries below.
function resolveUnsafeClient(db: DbConnection | DbTx): UnsafeFn {
  const dbAny = db as unknown as {
    $client?: { unsafe?: UnsafeFn };
    session?: { client?: { unsafe?: UnsafeFn } };
    unsafe?: UnsafeFn;
  };
  const client = dbAny.$client ?? dbAny.session?.client ?? dbAny;
  return (client as { unsafe: UnsafeFn }).unsafe;
}

// True when `<fullyQualifiedName>` refers to an existing relation in the
// current database. Thin wrapper over `to_regclass`, which returns NULL
// when the name doesn't resolve — the only postgres query that cheaply
// reports existence without raising an error on a missing relation.
//
// Used by framework-managed tables (events, archived_streams, snapshots,
// projections, event-consumers) whose createX() is called from multiple
// boot paths (setupTestStack, production boot, manual test setups). The
// guard keeps those calls idempotent without having to interpret the
// "already exists" error code.
//
//   if (await tableExists(db, "public.events")) return;
//   await unsafePushTables(db, { events: eventsTable });
export async function tableExists(
  db: DbConnection | DbTx,
  fullyQualifiedName: string,
): Promise<boolean> {
  const unsafe = resolveUnsafeClient(db);
  // quote_ident-Round-trip auf SQL-Seite: ohne Quotes folded postgres
  // unquoted identifier case-insensitiv (myWidget → mywidget), während die
  // generierte DDL den Namen via quoteIdent("myWidget") → "myWidget" case-
  // preserved schreibt. quote_ident sorgt für identische Quotierung beidseits.
  // Schema-qualifizierte Namen (`public.events`) werden per Split einzeln quotet.
  const dotIdx = fullyQualifiedName.indexOf(".");
  const [sql, params] =
    dotIdx >= 0
      ? [
          `SELECT to_regclass(quote_ident($1) || '.' || quote_ident($2)) IS NOT NULL AS exists`,
          [fullyQualifiedName.slice(0, dotIdx), fullyQualifiedName.slice(dotIdx + 1)],
        ]
      : [`SELECT to_regclass(quote_ident($1)) IS NOT NULL AS exists`, [fullyQualifiedName]];
  const rows = await unsafe(sql, params);
  return rows[0]?.["exists"] === true;
}

// Live column names of a `public` table, snake_case as stored. Empty set for a
// non-existent table (callers gate on tableExists first). Used by the schema-
// drift Layer-3 column-diff to catch a migrated-but-incomplete table (a
// snapshot column the physical table is missing) at boot instead of as a
// runtime-500 on the first write.
export async function columnNamesOf(
  db: DbConnection | DbTx,
  tableName: string,
): Promise<ReadonlySet<string>> {
  const unsafe = resolveUnsafeClient(db);
  const rows = await unsafe(
    "SELECT column_name FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND table_name = $1",
    [tableName],
  );
  const names = new Set<string>();
  for (const row of rows) {
    const name = row["column_name"];
    if (typeof name === "string") names.add(name);
  }
  return names;
}
