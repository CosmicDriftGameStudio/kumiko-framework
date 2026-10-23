import { existsSync, readdirSync } from "node:fs";
import type { EntityTableMeta } from "@cosmicdrift/kumiko-types/entity-table-meta-types";
import { isOneOf, isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { assertUniqueTableNames, loadSnapshotJson, type renderTablesDdl } from "../db/index.ts";
import {
  DEFAULT_ROW_LEVEL_SECURITY_MODE,
  ROW_LEVEL_SECURITY_MODES,
  type RowLevelSecurityMode,
} from "../db/render-rls-ddl.ts";
import { isEntityTableMeta } from "../db/table-introspection.ts";
import type { FeatureDefinition } from "../engine/types/feature.ts";

export type SchemaCliOut = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};

export type RunSchemaCliOptions =
  | { readonly features?: undefined; readonly kmsSlots?: undefined }
  | {
      /** Composed app features. When given, `apply` rebuilds the projections whose
       *  tables a freshly applied migration changed (via its `.rebuild.json`
       *  marker). Omitted (dev `kumiko schema`) → no rebuild, migrations only. */
      readonly features: readonly FeatureDefinition[];
      /** Schema-declared Key Manager slots, `kmsSlotsOf(composedEnv.schema)`, or
       *  `[]` when the app wires none. This CLI parses no env schema, so the
       *  rebuild's KMS wiring cannot derive them itself. */
      readonly kmsSlots: readonly string[];
    };

export type SchemaCliContext = {
  readonly argv: readonly string[];
  readonly out: SchemaCliOut;
  readonly options: RunSchemaCliOptions;
  readonly schemaFile: string;
  readonly migrationsDir: string;
};

export type SchemaSubcommandHandler = (ctx: SchemaCliContext) => Promise<number>;

export const SNAPSHOT_FILENAME = ".snapshot.json";

export type SchemaMod = {
  readonly entityMetas: Parameters<typeof renderTablesDdl>[0];
  readonly features?: unknown;
  readonly validateBootOptions?: unknown;
  readonly rowLevelSecurity: RowLevelSecurityMode;
};

// An absent export means the default mode; a typo must not silently switch tenant isolation off.
export function parseSchemaRowLevelSecurity(
  value: unknown,
  schemaFile: string,
): RowLevelSecurityMode {
  if (value === undefined) return DEFAULT_ROW_LEVEL_SECURITY_MODE;
  if (isOneOf(ROW_LEVEL_SECURITY_MODES, value)) return value;
  throw new Error(
    `Schema file ${schemaFile}: ROW_LEVEL_SECURITY must be one of ${ROW_LEVEL_SECURITY_MODES.join(", ")}, got ${String(value)}.`,
  );
}

export function describeThrown(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function tableNameHint(entry: unknown): string {
  if (isPlainObject(entry) && typeof entry["tableName"] === "string") return entry["tableName"];
  return "unknown";
}

// Single load-path for kumiko/schema.ts (512/3) — `generate` and `validate`
// both need ENTITY_METAS (and validate additionally wants FEATURES); this is
// the one place that enforces "ENTITY_METAS must be an array" so the two
// commands can't drift on the check or its wording. Throws — callers that
// want a graceful exit code (validate) catch it themselves.
async function loadSchemaModFromApp(schemaFile: string): Promise<SchemaMod> {
  // bun imports TS directly — no spawn needed.
  const mod: Record<string, unknown> = await import(schemaFile);
  const entityMetas = mod["ENTITY_METAS"];
  if (!Array.isArray(entityMetas)) {
    throw new Error(
      `Schema file ${schemaFile} must declare \`export const ENTITY_METAS: EntityTableMeta[]\`.`,
    );
  }
  const validMetas: EntityTableMeta[] = [];
  for (const [index, entry] of entityMetas.entries()) {
    if (!isEntityTableMeta(entry)) {
      throw new Error(
        `Schema file ${schemaFile}: ENTITY_METAS[${index}] is not an EntityTableMeta (table: ${tableNameHint(entry)}).`,
      );
    }
    validMetas.push(entry);
  }
  assertUniqueTableNames(validMetas);
  return {
    entityMetas: validMetas,
    features: mod["FEATURES"],
    validateBootOptions: mod["VALIDATE_BOOT_OPTIONS"],
    rowLevelSecurity: parseSchemaRowLevelSecurity(mod["ROW_LEVEL_SECURITY"], schemaFile),
  };
}

export function nextSequenceNumber(migrationsDir: string): number {
  if (!existsSync(migrationsDir)) return 1;
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  let max = 0;
  for (const f of files) {
    const m = f.match(/^(\d+)_/);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return max + 1;
}

export function loadPreviousSnapshot(snapshotPath: string) {
  return existsSync(snapshotPath) ? loadSnapshotJson(snapshotPath) : null;
}

export async function loadSchemaModOrReport(ctx: SchemaCliContext): Promise<SchemaMod | undefined> {
  const { out, schemaFile } = ctx;
  if (!existsSync(schemaFile)) {
    out.err(`  ${schemaFile} is missing.`);
    out.err("  App convention: kumiko/schema.ts with");
    out.err("    export const ENTITY_METAS: EntityTableMeta[] = [...]");
    return undefined;
  }
  try {
    return await loadSchemaModFromApp(schemaFile);
  } catch (e) {
    out.err(`  ${describeThrown(e)}`);
    return undefined;
  }
}

// `apply` needs only the mode: migrations and rebuilds on a role that RLS binds see nothing unless
// the connection runs in system scope, which only an "on" connection sets. Without a schema file
// (dev CLI against a bare checkout) there is nothing to enforce.
export async function loadRowLevelSecurityModeOrReport(
  ctx: SchemaCliContext,
): Promise<RowLevelSecurityMode | undefined> {
  if (!existsSync(ctx.schemaFile)) return "off";
  return (await loadSchemaModOrReport(ctx))?.rowLevelSecurity;
}

export function readDatabaseUrlOrReport(out: SchemaCliOut): string | undefined {
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    out.err("  DATABASE_URL not set.");
    return undefined;
  }
  return dbUrl;
}

export function migrationsDirExistsOrReport(ctx: SchemaCliContext): boolean {
  if (existsSync(ctx.migrationsDir)) return true;
  ctx.out.err(`  ${ctx.migrationsDir} is missing — run schema generate <name> first.`);
  return false;
}
