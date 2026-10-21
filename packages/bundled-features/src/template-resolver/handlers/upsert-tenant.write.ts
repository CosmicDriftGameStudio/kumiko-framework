import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import {
  refuseTemplateEdit,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { resolveTemplateVariables } from "../template-validation.ts";
import { upsertPayloadSchema } from "./shared.ts";
import { writeTemplateRow } from "./template-write.ts";

// Creates or updates a tenant override under event.user.tenantId with scope='tenant'.
// The default status is 'draft'; users must publish explicitly via the publish handler.
// SystemAdmin can write for another tenant through tenantIdOverride, typically to
// curate tenant templates from a platform admin UI.
export function makeUpsertTenantWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
    name: "upsert-tenant",
    schema: upsertPayloadSchema.extend({
      tenantIdOverride: z.string().min(1).optional(),
      status: z.enum(["draft", "active"]).default("draft"),
    }),
    access: templateEditAccess(policy.tenantEditable),
    description:
      "Creates or overwrites a tenant-scoped template override with its variable schema, landing as a draft that only publish makes live (over an active override the draft is stored beside it, the active version keeps being served until publish); it refuses a system-tenant target, which is what upsert-system is for; a TenantAdmin may write it only for templates the app lists in tenantEditable, otherwise SystemAdmin only.",
    handler: async (event, ctx) => {
      const refused = refuseTemplateEdit(policy, event.user, event.payload);
      if (refused !== null) return refused;
      // @cast-boundary engine-payload — override is a zod-validated string and
      // event.user.tenantId is already TenantId-branded; forTenant rejects the
      // override for non-SystemAdmins.
      const tenantId = (event.payload.tenantIdOverride ?? event.user.tenantId) as TenantId;
      return writeTemplateRow({
        ctx,
        user: event.user,
        tenantId,
        scope: "tenant",
        status: event.payload.status,
        variables: resolveTemplateVariables(
          ctx.registry,
          event.payload.slug,
          event.payload.variableSchema,
        ),
        payload: event.payload,
      });
    },
  });
}
