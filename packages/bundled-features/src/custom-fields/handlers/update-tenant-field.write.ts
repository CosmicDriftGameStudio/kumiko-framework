import { isSystemTenant, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failNotFound, failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { fieldDefinitionAggregateId } from "../aggregate-id.ts";
import { fieldDefinitionExecutor } from "../executor.ts";
import { buildFieldDefinitionColumns } from "../lib/field-definition-row.ts";
import { fieldTypeSchema, type UpdateFieldPayload, updateFieldPayloadSchema } from "../schemas.ts";
import { DEFAULT_FIELD_DEFINITION_WRITE_ROLES } from "../web/constants.ts";

// update-tenant-field: a TenantAdmin replaces the state of an existing field
// definition (full replacement: payload shape = define except that
// `serializedField.type` may be omitted). Identity is (entityName, fieldKey),
// giving the same deterministic aggregate id as define/delete; tenantId comes
// from event.user, so a cross-tenant mutation is impossible (a foreign
// definition derives a different aggregate id and yields 404).
//
// **type is immutable**; an omitted type keeps the stored one. A type change
// would orphan existing values in the host entities' customFields jsonb (a
// text value under a number field), so delete + re-define is the honest path
// (Bug-Bash D2: deliberately no delete+redefine inside update, since that
// destroys event history and field ids, which is exactly the break a type
// change needs to make visible).
//
// **Known MVP limit (deliberate):** the edit does NOT reconcile existing host
// values against the new definition. Narrowed constraints (enum value removed,
// tighter min/max) leave old values silently non-conformant, required
// false→true leaves existing rows incomplete, and toggling searchable does not
// re-index. Values are validated against the current definition on the NEXT
// write of the host row; a reject-with-conflict-list variant is the upgrade
// once the need is real.
//
// **skipOptimisticLock:** definition edits are admin-only and low-frequency
// (same trade-off as the quota soft cap in define), so last write wins instead
// of a version round trip through the edit screen.
export interface UpdateTenantFieldOptions {
  /** Access roles for this handler. Default ["TenantAdmin"] (#2296) — see
   *  DefineTenantFieldOptions.roles, the definition-CRUD triad shares one gate. */
  readonly roles?: readonly string[];
}

export function createUpdateTenantFieldHandler(
  opts: UpdateTenantFieldOptions = {},
): WriteHandlerDef {
  return {
    name: "update-tenant-field",
    schema: updateFieldPayloadSchema,
    access: { roles: opts.roles ?? DEFAULT_FIELD_DEFINITION_WRITE_ROLES },
    description:
      "Replaces a tenant-owned custom-field definition with a complete new spec; serializedField.type may be omitted, in which case the stored type applies, and a different type is refused. Use it to relabel or re-constrain an existing field rather than to create or remove one.",
    handler: async (event, ctx) => {
      const payload = event.payload as UpdateFieldPayload; // @cast-boundary engine-payload
      const tenantId = event.user.tenantId;

      if (isSystemTenant(tenantId)) {
        throw new Error(
          "update-tenant-field: tenantId is SYSTEM_TENANT_ID — system-scope definitions have no update handler (delete + re-define via the system-field handlers)",
        );
      }

      const aggregateId = fieldDefinitionAggregateId(
        tenantId,
        payload.entityName,
        payload.fieldKey,
      );

      const existing = await fieldDefinitionExecutor.detail(
        { id: aggregateId },
        event.user,
        ctx.db,
      );
      if (!existing) {
        return failNotFound("field-definition", aggregateId);
      }

      const storedType = fieldTypeSchema.safeParse(existing["type"]);
      if (!storedType.success) {
        throw new Error(
          `update-tenant-field: stored definition ${aggregateId} has an invalid type`,
        );
      }
      const requestedType = payload.serializedField.type;
      if (requestedType !== undefined && requestedType !== storedType.data) {
        return failUnprocessable("field_type_immutable", {
          entityName: payload.entityName,
          fieldKey: payload.fieldKey,
          currentType: storedType.data,
          requestedType,
        });
      }

      // entityName/fieldKey sind die Identität — nicht Teil der changes.
      const {
        entityName: _entityName,
        fieldKey: _fieldKey,
        ...changes
      } = buildFieldDefinitionColumns({
        ...payload,
        serializedField: { ...payload.serializedField, type: storedType.data },
      });

      return fieldDefinitionExecutor.update({ id: aggregateId, changes }, event.user, ctx.db, {
        skipOptimisticLock: true,
      });
    },
  };
}

// Backwards-compat: existing imports of `updateTenantFieldHandler` keep
// working — identical to createUpdateTenantFieldHandler() with default roles.
export const updateTenantFieldHandler: WriteHandlerDef = createUpdateTenantFieldHandler();
