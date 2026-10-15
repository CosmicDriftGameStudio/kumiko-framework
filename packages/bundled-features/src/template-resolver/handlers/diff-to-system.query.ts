import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { diffTemplateBlocks, splitTemplateBlocks } from "../template-diff.js";

function parseStoredMeta(raw: string | null): Readonly<Record<string, unknown>> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
}

function diffMeta(
  system: Readonly<Record<string, unknown>>,
  tenant: Readonly<Record<string, unknown>>,
) {
  const keys = [...new Set([...Object.keys(system), ...Object.keys(tenant)])].sort();
  return keys
    .filter((key) => JSON.stringify(system[key]) !== JSON.stringify(tenant[key]))
    .map((key) => ({ key, tenant: tenant[key], system: system[key] }));
}

export const diffToSystemQuery = defineQueryHandler({
  name: "diff-to-system",
  schema: z.object({ id: z.string().min(1) }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Compares one tenant override with the system template of the same slug, kind and locale block by block and lists the changed meta settings; use it to show what an override changes before resetting it to the system version.",
  handler: async (query, ctx) => {
    const tenantRow = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
      id: query.payload.id,
    });
    if (!tenantRow || tenantRow.tenantId !== query.user.tenantId || tenantRow.scope !== "tenant") {
      throw new NotFoundError("template-resource", query.payload.id);
    }
    const systemRow = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      slug: tenantRow.slug,
      kind: tenantRow.kind,
      locale: tenantRow.locale,
    });
    if (!systemRow) throw new NotFoundError("template-resource", tenantRow.slug);

    const blocks = diffTemplateBlocks(
      splitTemplateBlocks(systemRow.content ?? "", systemRow.contentFormat),
      splitTemplateBlocks(tenantRow.content ?? "", tenantRow.contentFormat),
    );
    const meta = diffMeta(parseStoredMeta(systemRow.meta), parseStoredMeta(tenantRow.meta));
    return {
      tenant: {
        templateId: String(tenantRow.id),
        templateVersion: tenantRow.version,
        contentFormat: tenantRow.contentFormat,
      },
      system: {
        templateId: String(systemRow.id),
        templateVersion: systemRow.version,
        contentFormat: systemRow.contentFormat,
      },
      identical: meta.length === 0 && blocks.every((block) => block.change === "same"),
      blocks,
      meta,
    };
  },
});
