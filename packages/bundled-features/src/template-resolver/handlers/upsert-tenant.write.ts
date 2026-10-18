import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { resolveTemplateVariables } from "../template-validation.ts";
import { upsertPayloadSchema } from "./shared.ts";
import { writeTemplateRow } from "./template-write.ts";

// Tenant-Override anlegen/updaten. Liegt unter event.user.tenantId,
// scope='tenant'. Default-Status='draft' — User publisht explizit
// via publish-Handler. SystemAdmin kann via tenantIdOverride für
// einen anderen Tenant schreiben (typisch: Plattform-Admin-UI das
// Tenant-Templates kuratiert).
export const upsertTenantWrite = defineWriteHandler({
  name: "upsert-tenant",
  schema: upsertPayloadSchema.extend({
    tenantIdOverride: z.string().min(1).optional(),
    status: z.enum(["draft", "active"]).default("draft"),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Creates or overwrites a tenant-scoped template override with its variable schema, landing as a draft that only publish makes live (over an active override the draft is stored beside it, the active version keeps being served until publish); it refuses a system-tenant target, which is what upsert-system is for.",
  handler: async (event, ctx) => {
    // @cast-boundary engine-payload — override aus Zod-parsed string,
    // event.user.tenantId schon TenantId-branded; union als TenantId casten
    // ist legit (override ist UUID-Format-validiert in schema).
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
