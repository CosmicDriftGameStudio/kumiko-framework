import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  ANONYMOUS_ROLE,
  isSystemTenant,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { fieldDefinitionTable } from "../executor.ts";
import { parseSerializedField, type SerializedFieldShape } from "./parse-serialized-field.ts";

export type EntityFieldDefinition = {
  readonly searchable: boolean;
  readonly field: SerializedFieldShape | null;
};

type DefinitionRow = {
  readonly fieldKey: string;
  readonly tenantId: TenantId;
  readonly searchable: boolean;
  readonly serializedField: unknown;
};

function parseOrNull(raw: unknown): SerializedFieldShape | null {
  try {
    return parseSerializedField(raw);
  } catch {
    return null;
  }
}

export async function loadEntityFieldDefinitions(
  db: TenantDb,
  entityName: string,
): Promise<ReadonlyMap<string, EntityFieldDefinition>> {
  // ponytail: one definitions read per query/document; cache per batch if reindex volume matters
  const rows = await db.selectMany<DefinitionRow>(fieldDefinitionTable, {
    entityName,
    isDeleted: false,
  });
  const winners = new Map<string, DefinitionRow>();
  for (const row of rows) {
    const existing = winners.get(row.fieldKey);
    if (!existing || (isSystemTenant(row.tenantId) && !isSystemTenant(existing.tenantId))) {
      winners.set(row.fieldKey, row);
    }
  }
  const definitions = new Map<string, EntityFieldDefinition>();
  for (const [fieldKey, row] of winners) {
    definitions.set(fieldKey, {
      searchable: row.searchable === true,
      field: parseOrNull(row.serializedField),
    });
  }
  return definitions;
}

export function fieldReadAllowed(field: SerializedFieldShape, roles: readonly string[]): boolean {
  const required = field.fieldAccess?.read;
  if (!required || required.length === 0) return true;
  // A field anonymous visitors may read is public, so signed-in roles see it too.
  if (required.includes(ANONYMOUS_ROLE)) return true;
  return roles.some((role) => required.includes(role));
}

export function readableCustomFields(
  values: Record<string, unknown>,
  definitions: ReadonlyMap<string, EntityFieldDefinition>,
  roles: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const field = definitions.get(key)?.field;
    if (field && fieldReadAllowed(field, roles)) result[key] = value;
  }
  return result;
}

export function indexableCustomFields(
  values: Record<string, unknown>,
  definitions: ReadonlyMap<string, EntityFieldDefinition>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const definition = definitions.get(key);
    if (!definition?.field || !definition.searchable) continue;
    const required = definition.field.fieldAccess?.read;
    if (required && required.length > 0) continue;
    result[key] = value;
  }
  return result;
}
