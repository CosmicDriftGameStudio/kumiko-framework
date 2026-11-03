import type { EntityDefinition } from "@cosmicdrift/kumiko-types/fields";
import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
import { checkWriteFieldOwnership } from "../engine/field-access.ts";
import { userCanCreateFieldRow, userCanWriteFieldRow } from "../engine/ownership.ts";
import type { SessionUser, TenantId } from "../engine/types/index.ts";
import type { WriteFailure } from "../errors/index.ts";
import type { DbRow } from "./connection.ts";
import { ownershipSubject } from "./event-store-executor-context.ts";
import { ownershipDeniedFailure } from "./event-store-executor-write-steps.ts";

export function createOwnershipFailure(options: {
  readonly entity: EntityDefinition;
  readonly entityName: string;
  readonly user: SessionUser;
  readonly streamTenantId: TenantId | undefined;
  readonly payloadWithoutId: Record<string, unknown>;
  readonly data: DbRow;
  readonly applyDefaults: (payload: Record<string, unknown>) => Record<string, unknown>;
}): WriteFailure | undefined {
  const { entity, entityName, user, streamTenantId, payloadWithoutId, data, applyDefaults } =
    options;
  // H.2 — entity-level write-ownership on create. No oldRow exists, so
  // only the new row is checked. No Straddle concern for creates.
  if (!userCanCreateFieldRow(ownershipSubject(user, streamTenantId), entity.access?.write, data)) {
    return ownershipDeniedFailure({
      scope: "entity",
      entityName,
      action: "create",
      userId: user.id,
    });
  }

  // Field-level write-ownership on create — mirror of entity-level but
  // per declared field. Role-level was already checked by the
  // dispatcher; here we enforce ownership-rules against the new row.
  //
  // Which fields get checked is scoped to the pre-hook payload
  // — a hook-derived field the user never submitted must not be
  // field-ownership-checked against the user. The rule for a checked
  // field is still evaluated against the full post-hook row (`data`) —
  // an ownership rule can reference a column only a hook populates.
  const fieldDeniedCreate = checkWriteFieldOwnership(
    entity,
    applyDefaults(payloadWithoutId),
    ownershipSubject(user, streamTenantId),
    undefined,
    data,
  );
  if (fieldDeniedCreate) {
    return ownershipDeniedFailure({
      scope: "field",
      entityName,
      action: "create",
      field: fieldDeniedCreate,
      userId: user.id,
    });
  }
  return undefined;
}

export function updateOwnershipFailure(options: {
  readonly entity: EntityDefinition;
  readonly entityName: string;
  readonly user: SessionUser;
  readonly streamTenantId: TenantId | undefined;
  readonly id: EntityId;
  readonly submittedChanges: Record<string, unknown>;
  readonly previous: DbRow;
  readonly changes: DbRow;
  readonly mergedNew: Record<string, unknown>;
}): WriteFailure | undefined {
  const {
    entity,
    entityName,
    user,
    streamTenantId,
    id,
    submittedChanges,
    previous,
    changes,
    mergedNew,
  } = options;
  // H.2 — entity-level write-ownership on update. Load old row (already
  // done above), build post-change row via shallow merge. Straddle-safe
  // multi-role check: at least one role must accept BOTH old and new —
  // prevents the attack where role A passes old, role B passes new and
  // aggregation would wrongly allow a row-grab.
  if (
    !userCanWriteFieldRow(
      ownershipSubject(user, streamTenantId),
      entity.access?.write,
      previous,
      mergedNew,
    )
  ) {
    return ownershipDeniedFailure({
      scope: "entity",
      entityName,
      action: "update",
      userId: user.id,
      entityId: id,
    });
  }
  // Field-level write-ownership on update — this is the path the
  // dispatcher could not evaluate (no oldRow). Now that we have
  // `previous`, we can run the ownership rules per field against both
  // sides and reject individual fields the user isn't entitled to
  // touch on this specific row.
  //
  // Which fields get checked is scoped to `payload.changes` (the user's
  // actual submission), NOT `changes` (post-preSave-hook data)
  // — a hook-derived field the user never submitted (e.g. a system hook
  // setting `assignedTo`) has no business being field-ownership-checked
  // against the *user*, and doing so rejects writes the user is fully
  // entitled to make. The dispatcher's role-gate (checkWriteFieldAccess)
  // already runs on this same pre-hook payload for consistency. The rule
  // for a checked field is still evaluated against the full post-hook
  // row (`changes` merged onto `previous`) — an ownership rule can
  // reference a column only a hook populates.
  const fieldDeniedUpdate = checkWriteFieldOwnership(
    entity,
    submittedChanges,
    ownershipSubject(user, streamTenantId),
    previous,
    changes,
  );
  if (fieldDeniedUpdate) {
    return ownershipDeniedFailure({
      scope: "field",
      entityName,
      action: "update",
      field: fieldDeniedUpdate,
      userId: user.id,
      entityId: id,
    });
  }
  return undefined;
}
