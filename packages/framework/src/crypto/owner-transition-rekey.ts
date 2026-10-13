import type { EntityDefinition } from "../engine/types/fields.js";
import { PII_ERASED_SENTINEL } from "./kms-adapter.js";
import { isPiiCiphertext } from "./pii-ciphertext-format.js";
import { nonEmptyString } from "./subject-resolver.js";

// Personal fields keep their stored value when an update moves the row to a
// new owner, so without re-keying they would stay shreddable only by the old
// owner. Returns the unchanged-by-the-caller values that must be written again
// so they encrypt under the new owner. Owner → absent is not a transition:
// the value stays with the last owner so that owner's forget still erases it.
export function personalFieldsRekeyedOnOwnerTransition(
  entity: EntityDefinition,
  previous: Record<string, unknown>,
  mergedNew: Record<string, unknown>,
  submittedChanges: Record<string, unknown>,
): Record<string, unknown> {
  const rekeyed: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(entity.fields)) {
    if (!("userOwned" in field) || field.userOwned === undefined) continue;
    if ("recordOwned" in field && field.recordOwned === true) continue;
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
