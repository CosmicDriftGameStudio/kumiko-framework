// T1.5c — user-data-rights wiring for custom-fields.

import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { EXT_USER_DATA, type FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import {
  selectCustomFieldsHostRows,
  selectFieldDefinitionsForEntity,
  stripSensitiveCustomFieldKeys,
} from "./db/queries/user-data-rights";
import { parseSerializedField } from "./lib/parse-serialized-field";

const KUMIKO_NAME_SYMBOL = Symbol.for("kumiko:schema:Name");
function getTableName(table: unknown): string {
  if (typeof table === "object" && table !== null) {
    const sym = (table as Record<symbol, unknown>)[KUMIKO_NAME_SYMBOL];
    if (typeof sym === "string") return sym;
  }
  throw new Error("wire-user-data-rights: table missing kumiko:schema:Name symbol");
}

export interface WireCustomFieldsUserDataRightsOptions {
  readonly entityName: string;
  readonly entityTable: unknown;
  readonly userIdColumn: string;
}

interface CustomFieldsHostRow {
  readonly id: string;
  readonly customFields: Record<string, unknown> | null;
}

function asCustomFieldsHostRow(value: unknown): CustomFieldsHostRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("id" in value) || typeof value.id !== "string") return null;
  const record = value as Record<string, unknown>;
  const cf = record["custom_fields"] ?? record["customFields"];
  if (cf === undefined) return null;
  if (cf === null) return { id: value.id, customFields: null };
  if (!cf || typeof cf !== "object" || Array.isArray(cf)) return null;
  return { id: value.id, customFields: Object.fromEntries(Object.entries(cf)) };
}

export function wireCustomFieldsUserDataRightsFor<TReg extends FeatureRegistrar<string>>(
  r: TReg,
  opts: WireCustomFieldsUserDataRightsOptions,
): void {
  const tableName = getTableName(opts.entityTable);

  const exportHook: UserDataExportHook = async (ctx) => {
    const rows = await selectCustomFieldsHostRows(
      ctx.db,
      tableName,
      opts.userIdColumn,
      ctx.userId,
      ctx.tenantId,
    );
    const snippetRows: Array<{ id: string; customFields: Record<string, unknown> }> = [];
    for (const raw of rows) {
      const row = asCustomFieldsHostRow(raw);
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
    // skip: delete strategy removes rows wholesale — custom-field redaction N/A.
    if (strategy === "delete") return;
    const sensitiveKeys = await loadSensitiveFieldKeys(ctx.db, ctx.tenantId, opts.entityName);
    // skip: no sensitive custom fields configured for this entity.
    if (sensitiveKeys.length === 0) return;

    await stripSensitiveCustomFieldKeys(
      ctx.db,
      tableName,
      opts.userIdColumn,
      sensitiveKeys,
      ctx.userId,
      ctx.tenantId,
    );
  };

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
  const rows = await selectFieldDefinitionsForEntity(db, entityName, tenantId);
  const keys: string[] = [];
  for (const raw of rows) {
    if (!isFieldDefinitionRow(raw)) continue;
    const parsed = parseSerializedField(raw.serialized_field);
    if (parsed?.sensitive === true) keys.push(raw.field_key);
  }
  return keys;
}
