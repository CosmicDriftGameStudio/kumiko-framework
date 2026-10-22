import { isSystemTenant, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { failUnprocessable } from "@cosmicdrift/kumiko-framework/errors";
import { fieldDefinitionAggregateId } from "../aggregate-id.ts";
import { defineOrResurrectFieldDefinition } from "../lib/define-or-resurrect.ts";
import { buildFieldDefinitionColumns } from "../lib/field-definition-row.ts";
import { countTenantFieldDefinitions } from "../lib/quota.ts";
import { type DefineFieldPayload, defineFieldPayloadSchema } from "../schemas.ts";
import { DEFAULT_FIELD_DEFINITION_WRITE_ROLES } from "../web/constants.ts";

// define-tenant-field — TenantAdmin defines a custom-field definition
// for its own tenant. tenantId is derived automatically from
// event.user.tenantId (NOT settable by the caller — prevents cross-tenant
// mutation).
//
// **Same-scope-conflict** is naturally enforced by the
// aggregate-version-conflict: the deterministic aggregate-id from
// uuidv5(tenant, entity, fieldKey) makes a second Create for the same
// definition a version_conflict. The dispatcher returns 409, providing a
// clean idempotency guarantee without an extra DB round trip.
//
// **Cross-scope-conflict** (a tenant attempts to define a fieldKey that
// already exists in the system scope) is NOT enforced here — the aggregate
// IDs differ (different tenantIds in uuidv5), so both writes proceed.
// Resolution at read time shows the system-scope value. A future version
// could introduce an r.systemScope sub-handler to reject cross-scope-conflict
// at write time.
//
// **Quota**: optional `fieldDefinitionLimitPerTenant` gate. When the tenant
// already has ≥ limit definitions, the handler rejects with `unprocessable`
// and reason `cap_exceeded` BEFORE attempting the insert. The factory below
// closes over the limit; the legacy const-export preserves behavior for
// callers that did not opt into a limit.
//
// Soft cap, not a hard guarantee: count-then-insert is not serialized, so
// N concurrent defines with distinct fieldKeys can each read `current < limit`
// and overshoot by up to N. This is acceptable because defining fields is an
// admin-only, low-frequency action and the limit is not wired to
// billing/tier enforcement. If an exact cap is ever needed, serialize via
// advisory lock or add a count constraint at the insert.
export interface DefineTenantFieldOptions {
  /** Soft cap — `>= limit` definitions per tenant rejects further defines (see header: concurrent defines may overshoot). */
  readonly fieldDefinitionLimitPerTenant?: number;
  /** Access roles for this handler. Default ["TenantAdmin"] — apps with
   *  their own role vocabulary pass this via createCustomFieldsFeature({
   *  fieldDefinitionWriteRoles }), which threads the same roles into
   *  update-/delete-tenant-field too (the definition-CRUD triad shares one gate). */
  readonly roles?: readonly string[];
}

const DEFINE_TENANT_FIELD_REASON =
  "counts custom field definitions with an explicit tenant_id = caller tenant via raw SQL with read retry";

export function createDefineTenantFieldHandler(
  opts: DefineTenantFieldOptions = {},
): WriteHandlerDef {
  const limit = opts.fieldDefinitionLimitPerTenant;
  return {
    name: "define-tenant-field",
    schema: defineFieldPayloadSchema,
    access: { roles: opts.roles ?? DEFAULT_FIELD_DEFINITION_WRITE_ROLES },
    description:
      "Creates a custom-field definition owned by the caller's own tenant on the named entity, rejecting the write once the tenant's definition quota is reached; use it when one tenant needs an extra field the other tenants must not see.",
    escapeHatch: {
      grants: ["unsafeRaw"],
      reason: DEFINE_TENANT_FIELD_REASON,
    },
    handler: async (event, ctx) => {
      const payload = event.payload as DefineFieldPayload; // @cast-boundary engine-payload
      const tenantId = event.user.tenantId;

      // TenantAdmin MUST NOT write to the system scope — strict guard.
      if (isSystemTenant(tenantId)) {
        throw new Error(
          "define-tenant-field: tenantId is SYSTEM_TENANT_ID — use define-system-field for system-scope definitions",
        );
      }

      if (limit !== undefined) {
        const current = await countTenantFieldDefinitions(ctx.db.unsafeRaw(), tenantId);
        if (current >= limit) {
          return failUnprocessable("cap_exceeded", {
            capName: "customFields.fieldDefinition.count",
            limit,
            current,
          });
        }
      }

      const aggregateId = fieldDefinitionAggregateId(
        tenantId,
        payload.entityName,
        payload.fieldKey,
      );

      return defineOrResurrectFieldDefinition(
        aggregateId,
        buildFieldDefinitionColumns(payload),
        event.user,
        ctx.db,
      );
    },
  };
}

// Backwards-compat: existing imports of `defineTenantFieldHandler` keep
// working — the handler has no quota, identical to behavior before the quota.
export const defineTenantFieldHandler: WriteHandlerDef = createDefineTenantFieldHandler();
