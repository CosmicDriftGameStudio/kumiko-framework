// T1.5c — user-data-rights wiring for custom-fields.

import { extractTableName } from "@cosmicdrift/kumiko-framework/db";
import type { UserDataDeleteHook, UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import {
  EXT_USER_DATA,
  EXT_USER_DATA_ORDER,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  selectCustomFieldsHostRows,
  selectFieldDefinitionsForEntity,
  stripSensitiveCustomFieldKeys,
} from "./db/queries/user-data-rights";
import { isFieldDefinitionRow, parseSerializedField } from "./lib/parse-serialized-field";

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

// The anonymize strip filters rows by `WHERE userIdColumn = userId`. A host
// anonymize hook on the SAME entity that nulls that column (e.g. inserted_by_id
// = NULL) would, if it ran first, leave the strip matching 0 rows → sensitive
// jsonb PII silently retained (DSGVO Art. 17 violation). A negative order makes
// runForgetCleanup run this strip before any default-order (0) owner-nulling
// hook, independent of feature registration order.
const ORDER_REDACT_BEFORE_OWNER_MUTATION = EXT_USER_DATA_ORDER.REDACT_BEFORE_OWNER;

export function wireCustomFieldsUserDataRightsFor<TReg extends FeatureRegistrar<string>>(
  r: TReg,
  opts: WireCustomFieldsUserDataRightsOptions,
): void {
  const tableName = extractTableName(opts.entityTable, "custom-fields/wire-user-data-rights");

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
    order: ORDER_REDACT_BEFORE_OWNER_MUTATION,
  });
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
