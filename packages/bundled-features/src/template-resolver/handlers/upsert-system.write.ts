import { defineWriteHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { resolveTemplateVariables } from "../template-validation.ts";
import { upsertPayloadSchema } from "./shared.ts";
import { writeTemplateRow } from "./template-write.ts";

// Creates or updates a system template under SYSTEM_TENANT_ID with
// scope='system'. Only SystemAdmin can change these global defaults;
// TenantAdmin uses upsertTenant for overrides instead.
export const upsertSystemWrite = defineWriteHandler({
  name: "upsert-system",
  schema: upsertPayloadSchema,
  access: { roles: ["SystemAdmin"] },
  description:
    "Creates or overwrites a system-default template under the system tenant with its full variable schema (resource files go through the resource upload), active straight away with no draft stage; SystemAdmin only, since tenants shadow these defaults through upsert-tenant instead.",
  handler: (event, ctx) =>
    writeTemplateRow({
      ctx,
      user: event.user,
      tenantId: SYSTEM_TENANT_ID,
      scope: "system",
      status: "active",
      variables: resolveTemplateVariables(
        ctx.registry,
        event.payload.slug,
        event.payload.variableSchema,
      ),
      payload: event.payload,
    }),
});
