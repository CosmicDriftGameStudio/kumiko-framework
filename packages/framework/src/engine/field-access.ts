import type { EntityDefinition, SessionUser } from "./types";

/**
 * Removes fields from data that the user is not allowed to read.
 * Fields without access config are visible to everyone.
 */
export function filterReadFields(
  entity: EntityDefinition,
  data: Readonly<Record<string, unknown>>,
  user: SessionUser,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const field = entity.fields[key];
    if (!field) {
      // Base columns (id, tenantId, version, etc.) — always visible
      result[key] = value;
      continue;
    }

    // Check top-level access first
    const readRoles = field.access?.read;
    if (readRoles && readRoles.length > 0 && !user.roles.some((role) => readRoles.includes(role))) {
      continue; // entire field stripped
    }

    // For embedded fields: filter sub-fields with access restrictions
    if (field.type === "embedded" && value && typeof value === "object") {
      const filtered: Record<string, unknown> = {};
      for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
        const subField = field.schema[subKey];
        const subReadRoles = subField?.access?.read;
        if (
          subReadRoles &&
          subReadRoles.length > 0 &&
          !user.roles.some((role) => subReadRoles.includes(role))
        ) {
          continue; // sub-field stripped
        }
        filtered[subKey] = subValue;
      }
      result[key] = filtered;
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Checks if the user is allowed to write all fields in the changes object.
 * Returns the field name that is denied, or null if all allowed.
 */
export function checkWriteFields(
  entity: EntityDefinition,
  changes: Readonly<Record<string, unknown>>,
  user: SessionUser,
): string | null {
  for (const key of Object.keys(changes)) {
    const field = entity.fields[key];
    if (!field) continue; // Base columns can't be written directly anyway

    const writeRoles = field.access?.write;
    if (writeRoles && writeRoles.length > 0) {
      if (!user.roles.some((role) => writeRoles.includes(role))) {
        return key;
      }
    }
  }

  return null;
}
