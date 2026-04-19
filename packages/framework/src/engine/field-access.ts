import type { DbRow } from "../db/connection";
import { normalizeAccessEntry, userCanReadFieldRow, userCanWriteFieldRow } from "./ownership";
import type { EntityDefinition, SessionUser } from "./types";

// Field-level read filtering. Returns a copy of `data` with fields stripped
// if the user's roles don't grant read access OR the ownership-rule for the
// matching role doesn't accept this concrete row. Fields without access
// config are visible to everyone.
//
// Removal is silent (field simply not present in the output) — this is the
// one place in the ownership system where silence is the right default:
// reporting "you tried to read X but can't" leaks the field's existence.
// Writes do the opposite (loud error) because a silent drop there masks
// save-bugs.
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

    const accessMap = normalizeAccessEntry(field.access?.read);
    if (!userCanReadFieldRow(user, accessMap, data)) {
      continue; // entire field stripped
    }

    // For embedded fields: filter sub-fields with access restrictions
    if (field.type === "embedded" && value && typeof value === "object") {
      const filtered: Record<string, unknown> = {};
      for (const [subKey, subValue] of Object.entries(value as DbRow)) {
        const subField = field.schema[subKey];
        const subAccess = normalizeAccessEntry(subField?.access?.read);
        if (!userCanReadFieldRow(user, subAccess, value as DbRow)) {
          continue;
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

// Role-only field-write check. Evaluates ONLY whether the user has at
// least one role mapped to the field's write-access — does NOT evaluate
// ownership rules against a row. The dispatcher calls this before the
// handler runs to catch clear-cut role denials (the common case), without
// needing to load old-row state.
//
// Ownership-level row-match for updates happens in the executor, where
// the pre-update row is already loaded. See checkWriteFieldOwnership.
//
// Returns the denied field name, or null if all fields pass the role gate.
export function checkWriteFieldRoles(
  entity: EntityDefinition,
  changes: Readonly<Record<string, unknown>>,
  user: SessionUser,
): string | null {
  for (const key of Object.keys(changes)) {
    const field = entity.fields[key];
    if (!field) continue;

    const accessMap = normalizeAccessEntry(field.access?.write);
    if (!accessMap) continue; // public write

    // Pure role-in-map check — ownership-rule evaluation is deferred.
    const hasRole = user.roles.some((role) => accessMap[role] !== undefined);
    if (!hasRole) return key;
  }
  return null;
}

// Full ownership-aware field-write check. Called from the executor after
// oldRow is loaded. Enforces Straddle-safe per-role atomicity: at least one
// of the user's roles must accept BOTH the old row AND the new (post-change)
// row. For creates, pass oldRow = undefined; the check degenerates to a
// newRow-only evaluation.
//
// Returns the denied field name for the caller to wrap into an
// `ownership_denied` error with scope: "field", or null if all fields pass.
export function checkWriteFieldOwnership(
  entity: EntityDefinition,
  changes: Readonly<Record<string, unknown>>,
  user: SessionUser,
  oldRow?: Readonly<Record<string, unknown>>,
): string | null {
  for (const key of Object.keys(changes)) {
    const field = entity.fields[key];
    if (!field) continue;

    const accessMap = normalizeAccessEntry(field.access?.write);
    if (!accessMap) continue;

    // Only run the ownership eval when the map actually has at least one
    // ownership-typed rule (i.e. at least one entry is NOT "all"). Pure
    // "all" maps are just role-in-map checks — already verified by the
    // dispatcher, no row-eval needed.
    const hasOwnershipRule = Object.values(accessMap).some((r) => r !== "all");
    if (!hasOwnershipRule) continue;

    const newRow: Record<string, unknown> = { ...(oldRow ?? {}), ...changes };
    const effectiveOld = oldRow ?? newRow; // create: compare against newRow

    if (!userCanWriteFieldRow(user, accessMap, effectiveOld, newRow)) {
      return key;
    }
  }
  return null;
}
