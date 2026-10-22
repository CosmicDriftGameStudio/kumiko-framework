import type { EntityDefinition } from "../engine/types/fields.ts";
import { PII_ERASED_SENTINEL } from "./kms-adapter.ts";
import { isPiiCiphertext } from "./pii-ciphertext-format.ts";
import { nonEmptyString } from "./subject-resolver.ts";

// userOwned and not recordOwned: the value follows the row's current owner.
export function isPlainUserOwnedField(
  field: EntityDefinition["fields"][string],
): field is EntityDefinition["fields"][string] & {
  readonly userOwned: { readonly ownerField: string };
} {
  if (!("userOwned" in field) || field.userOwned === undefined) return false;
  return !("recordOwned" in field && field.recordOwned === true);
}

// Personal fields keep their stored value when an update moves the row to a
// new owner, so without re-keying they would stay shreddable only by the old
// owner. Returns the unchanged-by-the-caller values that must be written again
// so they encrypt under the new owner. Owner → absent is not a transition:
// the value stays with the last owner so that owner's forget still erases it.
// Absent → owner moves a whenAbsent value (tenant or record key) to the owner's
// key; the created event stays keyed under the whenAbsent subject.
export function personalFieldsRekeyedOnOwnerTransition(
  entity: EntityDefinition,
  previous: Record<string, unknown>,
  mergedNew: Record<string, unknown>,
  submittedChanges: Record<string, unknown>,
): Record<string, unknown> {
  const rekeyed: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(entity.fields)) {
    if (!isPlainUserOwnedField(field)) continue;
    if (name in submittedChanges) continue;

    const { ownerField } = field.userOwned;
    const nextOwner = nonEmptyString(mergedNew[ownerField]);
    if (nextOwner === null || nextOwner === nonEmptyString(previous[ownerField])) continue;

    const value = previous[name];
    if (value === null || value === undefined || value === PII_ERASED_SENTINEL) continue;
    if (typeof value === "string" && isPiiCiphertext(value)) continue;
    rekeyed[name] = value;
  }
  return rekeyed;
}
