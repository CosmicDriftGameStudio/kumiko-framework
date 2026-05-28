import type { DbConnection, DbTx } from "./connection";

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
  const dbAny = db as unknown as {
    $client?: {
      unsafe: (s: string, p?: readonly unknown[]) => Promise<readonly { exists: boolean }[]>;
    };
    session?: {
      client?: {
        unsafe: (s: string, p?: readonly unknown[]) => Promise<readonly { exists: boolean }[]>;
      };
    };
    unsafe?: (s: string, p?: readonly unknown[]) => Promise<readonly { exists: boolean }[]>;
  };
  const client = dbAny.$client ?? dbAny.session?.client ?? dbAny;
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
  const rows = await (
    client as {
      unsafe: (s: string, p?: readonly unknown[]) => Promise<readonly { exists: boolean }[]>;
    }
  ).unsafe(sql, params);
  return rows[0]?.exists ?? false;
}
