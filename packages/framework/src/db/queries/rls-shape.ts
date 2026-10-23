// Flags plus policy name, kind and command of a table, read from the catalogs without deparsing
// policy expressions. pg_get_expr (behind the pg_policies view) opens the table with ACCESS SHARE,
// which queues behind a pending ACCESS EXCLUSIVE; this read never touches the table itself.

import { type AnyDb, asRawClient } from "../query.ts";
import type { RowLevelSecurityPolicy } from "../render-rls-ddl.ts";

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

export async function readRowLevelSecurityShape(
  db: AnyDb,
  tableName: string,
): Promise<RowLevelSecurityShape | undefined> {
  const rows = await asRawClient(db).unsafe<ShapeRow>(
    `SELECT c.relrowsecurity, c.relforcerowsecurity, p.polname, p.polpermissive, p.polcmd::text AS polcmd, (p.polroles = '{0}'::oid[]) AS polpublic
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_policy p ON p.polrelid = c.oid
     WHERE n.nspname = 'public' AND c.relname = $1`,
    [tableName],
  );
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
