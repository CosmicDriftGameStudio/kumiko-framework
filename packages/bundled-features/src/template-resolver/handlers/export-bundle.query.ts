import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  isFileAttachmentEntry,
  type LinkedResourceEntry,
  parseLinkedResourceEntries,
} from "../linked-resources.js";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import type { TemplateBundle } from "../template-bundle.js";
import { readTemplateResource } from "../template-resources.js";
import { kindSchema, templateSlugSchema } from "./shared.js";
import { parseStoredJson, storedRecord } from "./template-gates.js";

export const exportBundleQuery = defineQueryHandler({
  name: "export-bundle",
  schema: z.object({
    slug: templateSlugSchema,
    kind: kindSchema,
    scope: z.enum(["tenant", "system"]).default("tenant"),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Exports every locale of one template (the caller's own rows, or the active system rows) together with its linked resource files as a self-contained bundle that import-bundle can read back, for example to move a template between tenants or environments.",
  handler: async (query, ctx) => {
    const { slug, kind, scope } = query.payload;
    const found = await selectMany<TemplateResourceRow>(
      ctx.db,
      templateResourcesTable,
      scope === "system"
        ? { tenantId: SYSTEM_TENANT_ID, slug, kind, scope: "system", status: "active" }
        : { tenantId: query.user.tenantId, slug, kind, scope: "tenant" },
    );
    const rows = found
      .filter((row) => row.status !== "archived")
      .sort((a, b) => a.locale.localeCompare(b.locale));
    const first = rows[0];
    if (!first) throw new NotFoundError("template-resource", slug);

    const locales: Record<string, { body: string; meta?: unknown }> = {};
    const entryByKey = new Map<string, LinkedResourceEntry>();
    for (const row of rows) {
      const meta = parseStoredJson(row.meta);
      locales[row.locale] = { body: row.content ?? "", ...(meta === undefined ? {} : { meta }) };
      for (const [key, entry] of Object.entries(parseLinkedResourceEntries(row.linkedResources))) {
        if (!entryByKey.has(key)) entryByKey.set(key, entry);
      }
    }

    const resources: TemplateBundle["resources"] = {};
    for (const [key, entry] of entryByKey) {
      const attachment = isFileAttachmentEntry(entry);
      const file = await readTemplateResource(
        { db: ctx.db, files: ctx.files, user: query.user },
        attachment ? entry.fileRefId : entry,
      );
      if (!file) throw new NotFoundError("template-resource-file", key);
      resources[key] = {
        fileName: attachment ? entry.fileName : file.fileName,
        contentType: file.contentType,
        base64: Buffer.from(file.bytes).toString("base64"),
        ...(attachment && { purpose: "attachment" as const }),
      };
    }

    return {
      slug,
      kind,
      contentFormat: first.contentFormat,
      variableSchema: storedRecord(first.variableSchema),
      locales,
      resources,
    };
  },
});
