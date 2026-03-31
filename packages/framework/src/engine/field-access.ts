import type { EntityDefinition, PipelineUser } from "./types";

/**
 * Removes fields from data that the user is not allowed to read.
 * Fields without access config are visible to everyone.
 */
export function filterReadFields(
  entity: EntityDefinition,
  data: Readonly<Record<string, unknown>>,
  user: PipelineUser,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const field = entity.fields[key];
    if (!field) {
      // Base columns (id, tenantId, version, etc.) — always visible
      result[key] = value;
      continue;
    }

    const readRoles = field.access?.read;
    if (!readRoles || readRoles.length === 0) {
      // No access restriction — everyone can read
      result[key] = value;
    } else if (user.roles.some((role) => readRoles.includes(role))) {
      result[key] = value;
    }
    // else: field is stripped from response
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
  user: PipelineUser,
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
