// T1.5c — user-data-rights wiring for custom-fields.

import { extractTableName } from "@cosmicdrift/kumiko-framework/db";
import type { UserDataExportHook } from "@cosmicdrift/kumiko-framework/engine";
import { EXT_USER_DATA, type FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";
import { selectCustomFieldsHostRows } from "./db/queries/user-data-rights";

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

// Export-only wiring: custom fields hold supplemental business data, not PII
// (#972) — there is nothing to redact on user-forget, only Art. 20 export.
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

  // biome-ignore lint/correctness/useHookAtTopLevel: r.useExtension is a registrar API, not a React hook.
  r.useExtension(EXT_USER_DATA, opts.entityName, {
    export: exportHook,
  });
}
