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

// Check if the user is allowed to write all fields in the changes object.
// For updates: pass oldRow (the existing projection) so the Straddle-safe
// multi-role check can run. For creates: pass an empty object as oldRow
// (or the same as newRow — Straddle only applies to updates).
//
// Returns the first field-name that's denied, or null if all allowed.
// Callers translate the returned name into a `field_ownership_denied`
// (ownership mismatch) or `field_access_denied` (role denial) error —
// both fail-loud, never silent.
export function checkWriteFields(
  entity: EntityDefinition,
  changes: Readonly<Record<string, unknown>>,
  user: SessionUser,
  // Old row for Straddle-check. Undefined for creates (no old row exists).
  oldRow?: Readonly<Record<string, unknown>>,
): string | null {
  for (const key of Object.keys(changes)) {
    const field = entity.fields[key];
    if (!field) continue; // Base columns can't be written directly anyway

    const accessMap = normalizeAccessEntry(field.access?.write);
    if (!accessMap) continue; // public write

    // Construct the "new row" view for this field's check: merge the
    // changes over the oldRow. For a standalone field check at change-
    // level, the ownership rule may depend on OTHER columns in the row
    // (e.g. "write propC if row.teamId matches claim") — so the checker
    // needs the full post-change row shape.
    const newRow: Record<string, unknown> = { ...(oldRow ?? {}), ...changes };

    // Create: no oldRow → only the new row matters. No Straddle risk since
    // there's nothing old to grab from.
    if (!oldRow) {
      // Reuse userCanWriteFieldRow with an empty old-row: the "all" and
      // write-rules evaluate only against newRow for creates when the
      // caller passes the same row twice.
      if (!userCanWriteFieldRow(user, accessMap, newRow, newRow)) {
        return key;
      }
      continue;
    }

    if (!userCanWriteFieldRow(user, accessMap, oldRow, newRow)) {
      return key;
    }
  }

  return null;
}
