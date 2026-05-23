import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  defineWriteHandler,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import type { TemplateResourceRow } from "../table";
import { templateResourcesTable } from "../table";
import { executor, upsertPayloadSchema } from "./shared";

// System-Template anlegen/updaten. Liegt unter SYSTEM_TENANT_ID,
// scope='system'. Nur SystemAdmin (globale Rolle). TenantAdmin kann
// keine System-Defaults überschreiben — der nutzt upsertTenant für
// Overrides.
export const upsertSystemWrite = defineWriteHandler({
  name: "upsert-system",
  schema: upsertPayloadSchema,
  access: { roles: ["SystemAdmin"] },
  handler: async (event, ctx) => {
    const db = ctx.db;
    // @cast-boundary engine-payload — SYSTEM_TENANT_ID ist UUID-Literal,
    // assert auf TenantId-Branded-Type (parseTenantId-Equivalent).
    const tenantId = SYSTEM_TENANT_ID as TenantId;
    // executor-user muss SYSTEM_TENANT als tenantId haben, sonst sucht
    // event-store stream unter user.tenantId statt SYSTEM_TENANT → conflict.
    // Pattern symmetrisch zu text-content setWrite Override-Branch.
    const executorUser = { ...event.user, tenantId };

    const existing = await fetchOne<TemplateResourceRow>(
      db,
      templateResourcesTable,
      { tenantId, slug: event.payload.slug, kind: event.payload.kind, locale: event.payload.locale },
    );

    const fields = {
      slug: event.payload.slug,
      kind: event.payload.kind,
      locale: event.payload.locale,
      content: event.payload.content,
      contentFormat: event.payload.contentFormat,
      variableSchema: JSON.stringify(event.payload.variableSchema),
      linkedResources: JSON.stringify(event.payload.linkedResources),
      scope: "system" as const,
      parentTemplateId: event.payload.parentTemplateId ?? null,
      // System-Defaults sind sofort active (kein draft-Stage für seeds).
      status: "active" as const,
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
