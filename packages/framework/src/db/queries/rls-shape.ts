// Flags plus policy name, kind and command of a table, read from the catalogs without deparsing
// policy expressions. pg_get_expr (behind the pg_policies view) opens the table with ACCESS SHARE,
// which queues behind a pending ACCESS EXCLUSIVE; this read never touches the table itself.

import { type AnyDb, asRawClient } from "../query.ts";
import { type RowLevelSecurityPolicy, TENANT_ISOLATION_POLICY } from "../render-rls-ddl.ts";

export type RowLevelSecurityShape = {
  readonly enabled: boolean;
  readonly forced: boolean;
  readonly policies: readonly (Pick<RowLevelSecurityPolicy, "name" | "kind" | "command"> & {
    readonly appliesToPublic: boolean;
  })[];
};

const COMMAND_BY_CODE = {
  "*": "ALL",
  r: "SELECT",
  a: "INSERT",
  w: "UPDATE",
  d: "DELETE",
} as const;

type ShapeRow = {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  polname: string | null;
  polpermissive: boolean | null;
  polcmd: string | null;
  polpublic: boolean | null;
};

function commandOf(code: string): RowLevelSecurityPolicy["command"] {
  const command = Object.entries(COMMAND_BY_CODE).find(([key]) => key === code)?.[1];
  // Fail closed: a policy command this check does not know cannot be judged harmless.
  if (command === undefined) throw new Error(`unknown pg_policy.polcmd code "${code}"`);
  return command;
}

function shapeOfRows(rows: readonly ShapeRow[]): RowLevelSecurityShape | undefined {
  const first = rows[0];
  if (first === undefined) return undefined;
  const policies = rows.flatMap((row) => {
    if (row.polname === null || row.polcmd === null) return [];
    const command = commandOf(row.polcmd);
    return [
      {
        name: row.polname,
        kind: row.polpermissive ? "PERMISSIVE" : "RESTRICTIVE",
        command,
        appliesToPublic: row.polpublic === true,
      },
    ] as const;
  });
  return { enabled: first.relrowsecurity, forced: first.relforcerowsecurity, policies };
}

export async function readRowLevelSecurityShapes(
  db: AnyDb,
  tableNames: readonly string[],
): Promise<ReadonlyMap<string, RowLevelSecurityShape>> {
  const shapes = new Map<string, RowLevelSecurityShape>();
  if (tableNames.length === 0) return shapes;
  const rows = await asRawClient(db).unsafe<ShapeRow>(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, p.polname, p.polpermissive, p.polcmd::text AS polcmd, (p.polroles = '{0}'::oid[]) AS polpublic
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_policy p ON p.polrelid = c.oid
     WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
    [tableNames],
  );
  const rowsByTable = Map.groupBy(rows, (row) => row.relname);
  for (const [tableName, tableRows] of rowsByTable) {
    const shape = shapeOfRows(tableRows);
    if (shape !== undefined) shapes.set(tableName, shape);
  }
  return shapes;
}

export async function readRowLevelSecurityShape(
  db: AnyDb,
  tableName: string,
): Promise<RowLevelSecurityShape | undefined> {
  return (await readRowLevelSecurityShapes(db, [tableName])).get(tableName);
}

// Shared by the rebuild guard and the boot check, so both judge a hand-edited policy alike.
export function isFrameworkIsolationIntact(shape: RowLevelSecurityShape): boolean {
  const isolation = shape.policies.find((policy) => policy.name === TENANT_ISOLATION_POLICY);
  return (
    isolation !== undefined &&
    isolation.kind === "PERMISSIVE" &&
    isolation.command === "ALL" &&
    isolation.appliesToPublic &&
    !shape.policies.some((policy) => policy.kind === "RESTRICTIVE")
  );
}
