import type { ExecutorUpdateOptions } from "@cosmicdrift/kumiko-types/event-store-executor-types";
import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import { keepHiddenEmbeddedSubFields } from "../engine/field-access.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { ValidationError, type WriteFailure, writeFailure } from "../errors/index.ts";
import type { DbRow } from "./connection.ts";
import { ownershipSubject } from "./event-store-executor-context.ts";
import { isStatutorySystemWrite } from "./lock-guard.ts";

export function keepHiddenSubFields(
  entity: EntityDefinition,
  changes: DbRow,
  previous: DbRow,
  user: SessionUser,
  updateOptions: ExecutorUpdateOptions | undefined,
): { readonly changes: DbRow } | { readonly failure: WriteFailure } {
  // Retention and erasure read the stored row, not a filtered view, and must clear what it holds.
  if (isStatutorySystemWrite(user, updateOptions)) return { changes };
  const subject = ownershipSubject(user, updateOptions?.streamTenantId);
  const kept = keepHiddenEmbeddedSubFields(entity, changes, previous, subject);
  if (kept.kind === "kept") return { changes: kept.changes };
  const code = kept.kind === "hiddenRowDropped" ? "hidden_row_removed" : "hidden_row_changed";
  return {
    failure: writeFailure(
      new ValidationError({
        fields: [{ path: kept.fieldName, code, i18nKey: `errors.validation.${code}` }],
      }),
    ),
  };
}
