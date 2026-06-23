import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  crossTenantOverrideDenied,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import type { TemplateResourceRow } from "../table";
import { templateResourcesTable } from "../table";
import { executor, upsertPayloadSchema } from "./shared";

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
  handler: async (event, ctx) => {
    const db = ctx.db;
    const override = event.payload.tenantIdOverride;
    const overrideDenied = crossTenantOverrideDenied(
      event.user,
      override,
      "templateResolver.errors.tenantOverrideRequiresSystemAdmin",
    );
    if (overrideDenied) return writeFailure(overrideDenied);
    // upsertTenant erzeugt scope='tenant'. SYSTEM_TENANT_ID-Override würde
    // scope='tenant' unter SYSTEM_TENANT_ID schreiben → inkonsistenter Zustand
    // (Resolver-Logik trennt sauber zwischen system+tenant). SystemAdmin muss
    // upsertSystem für System-Defaults nutzen.
    if (override === SYSTEM_TENANT_ID) {
      return writeFailure(
        new AccessDeniedError({
          i18nKey: "templateResolver.errors.useUpsertSystemForSystemTenant",
          details: { reason: "system_tenant_override_not_allowed_use_upsert_system" },
        }),
      );
    }
    // @cast-boundary engine-payload — override aus Zod-parsed string,
    // event.user.tenantId schon TenantId-branded; union als TenantId casten
    // ist legit (override ist UUID-Format-validiert in schema).
    const tenantId = (override ?? event.user.tenantId) as TenantId;
    const executorUser = override !== undefined ? { ...event.user, tenantId } : event.user;

    const existing = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId,
      slug: event.payload.slug,
      kind: event.payload.kind,
      locale: event.payload.locale,
    });

    const fields = {
      slug: event.payload.slug,
      kind: event.payload.kind,
      locale: event.payload.locale,
      content: event.payload.content,
      contentFormat: event.payload.contentFormat,
      variableSchema: JSON.stringify(event.payload.variableSchema),
      linkedResources: JSON.stringify(event.payload.linkedResources),
      scope: "tenant" as const,
      parentTemplateId: event.payload.parentTemplateId ?? null,
      status: event.payload.status,
    };

    if (existing) {
      const result = await executor.update(
        { id: existing.id, version: existing.version, changes: fields },
        executorUser,
        db,
      );
      if (!result.isSuccess) return result;
      return {
        isSuccess: true as const,
        data: { id: String(existing.id), slug: event.payload.slug, isNew: false },
      };
    }

    const result = await executor.create({ ...fields, tenantId }, executorUser, db);
    if (!result.isSuccess) return result;
    // @cast-boundary db-row — executor.create returnt Record-row aus
    // INSERT RETURNING; shape { id } ist garantiert weil PK in der
    // Returning-Klausel ist.
    const createdRow = result.data as { id: string | number };
    return {
      isSuccess: true as const,
      data: {
        id: String(createdRow.id),
        slug: event.payload.slug,
        isNew: true,
      },
    };
  },
});
