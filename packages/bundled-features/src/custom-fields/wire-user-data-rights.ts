// T1.5c — user-data-rights wiring for custom-fields.
//
// A consumer that wires `customFields` onto a user-owned host entity
// (e.g. `comment`, `note`, anything with an inserted_by_id column) calls
// this in addition to `wireCustomFieldsFor`:
//
//   wireCustomFieldsFor(r, "comment", commentTable);
//   wireCustomFieldsUserDataRightsFor(r, {
//     entityName: "comment",
//     entityTable: commentTable,
//     userIdColumn: "inserted_by_id",
//   });
//
// Result: a second `r.useExtension(EXT_USER_DATA, "comment", { export, delete })`
// registration whose hooks read/write the customFields jsonb column.
//
// **Export** — every row owned by the user is included; the full customFields
// jsonb travels into the user's export bundle so they can see *all* their
// custom-field data, sensitive or not (DSGVO Art. 15+20 — completeness wins).
//
// **Forget (strategy=anonymize)** — only `sensitive=true` customField keys are
// stripped from the jsonb (`customFields - 'sensitiveKey1' - 'sensitiveKey2'`).
// Non-sensitive customFields stay so the row remains useful to other tenants
// / co-authors. Matches the host-entity anonymize-then-keep contract.
//
// **Forget (strategy=delete)** — no-op. The host entity's own user-data-rights
// hook will delete the row entirely; jsonb goes with it.
//
// Side-step: this wiring requires `user-data-rights` to be installed in the
// composed feature set; if it's not, the boot-validator will reject the
// extension as unknown. That is the consumer's call — it's explicitly opt-in
// (call this function or don't), exactly because some consumers wire custom-
// fields onto tenant-owned entities (e.g. `property`) where DSGVO forget
// doesn't apply per-user.

import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { EXT_USER_DATA, type FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { parseSerializedField } from "./lib/parse-serialized-field";

const DRIZZLE_NAME_SYMBOL = Symbol.for("drizzle:Name");
function getTableName(table: unknown): string {
  if (typeof table === "object" && table !== null) {
    const sym = (table as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL];
    if (typeof sym === "string") return sym;
  }
  throw new Error("wire-user-data-rights: table missing drizzle:Name symbol");
}

export interface WireCustomFieldsUserDataRightsOptions {
  /** Host entity name as registered with wireCustomFieldsFor. */
  readonly entityName: string;
  /** Drizzle table for the host entity. Must have a `customFields` jsonb column. */
  readonly entityTable: unknown;
  /**
   * Snake-case DB column that holds the owning user's id (e.g. `inserted_by_id`,
   * `author_id`, `assignee_id`). The hooks filter rows on this + tenant_id.
   */
  readonly userIdColumn: string;
}

interface CustomFieldsHostRow {
  readonly id: string;
  readonly customFields: Record<string, unknown> | null;
}

// Drizzle's raw `execute(sql\`SELECT id, custom_fields\`)` returns rows
// keyed in db-column casing (snake_case), not the field-mapping casing.
// The typeguard normalises into the camel-cased internal shape so the
// rest of the hook can stay JS-idiomatic. `in` + `instanceof Object` keep
// the narrowing cast-free.
function asCustomFieldsHostRow(value: unknown): CustomFieldsHostRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("id" in value) || typeof value.id !== "string") return null;
  if (!("custom_fields" in value)) return null;
  const cf = value.custom_fields;
  if (cf === null) return { id: value.id, customFields: null };
  if (!cf || typeof cf !== "object" || Array.isArray(cf)) return null;
  // Object.entries on a narrowed `object` returns `[string, unknown][]` —
  // fromEntries widens that back into a typed Record without a cast.
  return { id: value.id, customFields: Object.fromEntries(Object.entries(cf)) };
}

export function wireCustomFieldsUserDataRightsFor<TReg extends FeatureRegistrar<string>>(
  r: TReg,
  opts: WireCustomFieldsUserDataRightsOptions,
): void {
  const tableName = `"${getTableName(opts.entityTable)}"`;
  const userCol = `"${opts.userIdColumn}"`;

  const exportHook: UserDataExportHook = async (ctx) => {
    const rowsResult = await asRawClient(ctx.db).unsafe(
      `SELECT id, custom_fields FROM ${tableName} WHERE ${userCol} = $1 AND tenant_id = $2`,
      [ctx.userId, ctx.tenantId],
    );
    const rows: ReadonlyArray<unknown> = Array.isArray(rowsResult) ? rowsResult : [];
    const snippetRows: Array<{ id: string; customFields: Record<string, unknown> }> = [];
    for (const raw of rows) {
      const row = asCustomFieldsHostRow(raw);
      // skip: drizzle-execute can hand back loosely-typed rows from raw
      // queries; if a row's shape doesn't fit, skip rather than guess.
      // Real schemas always match — this is defense in depth.
      if (!row) continue;
      const customFields = row.customFields;
      if (customFields && Object.keys(customFields).length > 0) {
        snippetRows.push({ id: row.id, customFields });
      }
    }
    if (snippetRows.length === 0) return null;
    return { entity: `${opts.entityName}.customFields`, rows: snippetRows };
  };

  const deleteHook: UserDataDeleteHook = async (ctx, strategy) => {
    // skip: strategy=delete is handled by the host entity's own user-
    // data-rights hook (it removes the row; customFields jsonb travels
    // with it). Nothing left for this layer to do.
    if (strategy === "delete") return;
    const sensitiveKeys = await loadSensitiveFieldKeys(ctx.db, ctx.tenantId, opts.entityName);
    // skip: no sensitive keys declared for this entity → anonymize is a
    // no-op. Avoids a useless UPDATE statement.
    if (sensitiveKeys.length === 0) return;

    // Build the chain of jsonb minus operators: custom_fields - $1 - $2 - ...
    const placeholders = sensitiveKeys.map((_, i) => `$${i + 1}`).join(" - ");
    await asRawClient(ctx.db).unsafe(
      `UPDATE ${tableName} SET custom_fields = custom_fields - ${placeholders} WHERE ${userCol} = $${sensitiveKeys.length + 1} AND tenant_id = $${sensitiveKeys.length + 2}`,
      [...sensitiveKeys, ctx.userId, ctx.tenantId],
    );
  };

  // r.useExtension's options-bag accepts a structural object — pass the
  // hooks inline so TS sees the literal-typed shape and Drizzle's strict
  // mode doesn't reject the nominal UserDataExtensionHooks branding.
  // biome-ignore lint/correctness/useHookAtTopLevel: r.useExtension is a registrar API, not a React hook.
  r.useExtension(EXT_USER_DATA, opts.entityName, {
    export: exportHook,
    delete: deleteHook,
  });
}

interface FieldDefinitionRow {
  readonly field_key: string;
  readonly serialized_field: unknown;
}

function isFieldDefinitionRow(value: unknown): value is FieldDefinitionRow {
  if (!value || typeof value !== "object") return false;
  if (!("field_key" in value)) return false;
  return typeof value.field_key === "string";
}

async function loadSensitiveFieldKeys(
  db: Parameters<UserDataExportHook>[0]["db"],
  tenantId: string,
  entityName: string,
): Promise<string[]> {
  const rowsResult = await asRawClient(db).unsafe(
    "SELECT field_key, serialized_field FROM read_custom_field_definitions WHERE entity_name = $1 AND tenant_id = $2",
    [entityName, tenantId],
  );
  const rows: ReadonlyArray<unknown> = Array.isArray(rowsResult) ? rowsResult : [];
  const keys: string[] = [];
  for (const raw of rows) {
    // skip: see isCustomFieldsHostRow rationale — defense in depth against
    // driver shape drift.
    if (!isFieldDefinitionRow(raw)) continue;
    const parsed = parseSerializedField(raw.serialized_field);
    if (parsed?.sensitive === true) keys.push(raw.field_key);
  }
  return keys;
}
