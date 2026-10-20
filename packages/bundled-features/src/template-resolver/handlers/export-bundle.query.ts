import { isDeepStrictEqual } from "node:util";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import {
  isFileAttachmentEntry,
  isPdfAttachmentLink,
  type LinkedResourceEntry,
  parseLinkedResourceEntries,
} from "../linked-resources.ts";
import { TemplateResolverErrors } from "../qualified-names.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import type { TemplateBundle } from "../template-bundle.ts";
import { deliveryPolicyOf, isRowServedTo } from "../template-delivery-policy.ts";
import { readTemplateResource } from "../template-resources.ts";
import { kindSchema, templateSlugSchema } from "./shared.ts";
import { parseStoredJson, storedRecord } from "./template-gates.ts";

// The files live in the system tenant's key space; readTemplateResource only
// serves the caller's own tenant, so anyone else would end in a misleading NotFound.
function assertSystemFilesReadable(
  scope: "tenant" | "system",
  entries: Iterable<LinkedResourceEntry>,
  callerTenantId: string,
): void {
  // skip: tenant exports read the caller's own files.
  if (scope === "tenant") return;
  // skip: the system tenant reads its own key space.
  if (callerTenantId === SYSTEM_TENANT_ID) return;
  const hasFileResources = [...entries].some((entry) => !isPdfAttachmentLink(entry));
  // skip: PDF attachment links carry no file to read.
  if (!hasFileResources) return;
  throw new ValidationError({
    fields: [
      {
        path: "scope",
        code: "system_resources_need_system_tenant",
        i18nKey: "templateResolver.errors.template.systemResourcesNeedSystemTenant",
      },
    ],
  });
}

// A bundle carries one contentFormat and one variableSchema for all locales; importing it would
// relabel the rows that differ from the first.
function assertLocalesShareFormat(rows: readonly TemplateResourceRow[]): void {
  const [first, ...rest] = rows;
  // skip: a bundle without rows has nothing to compare
  if (first === undefined) return;
  const firstSchema = storedRecord(first.variableSchema);
  const differing = rest.find(
    (row) =>
      row.contentFormat !== first.contentFormat ||
      !isDeepStrictEqual(storedRecord(row.variableSchema), firstSchema),
  );
  // skip: all locales agree
  if (differing === undefined) return;
  throw new ValidationError({
    fields: [
      {
        path: "slug",
        code: TemplateResolverErrors.bundleLocalesDiffer,
        i18nKey: "templateResolver.errors.template.bundleLocalesDiffer",
      },
    ],
  });
}

function localeEntryOf(row: TemplateResourceRow): { body: string; meta?: unknown; title?: string } {
  const meta = parseStoredJson(row.meta);
  return {
    body: row.content ?? "",
    ...(meta === undefined ? {} : { meta }),
    ...(row.title === null ? {} : { title: row.title }),
  };
}

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
    const policy = deliveryPolicyOf(ctx.registry);
    const rows = found
      .filter((row) => isRowServedTo(policy, query.user, row))
      .filter((row) => row.status !== "archived")
      .sort((a, b) => a.locale.localeCompare(b.locale));
    const first = rows[0];
    if (!first) throw new NotFoundError("template-resource", slug);
    assertLocalesShareFormat(rows);

    const locales: Record<string, { body: string; meta?: unknown; title?: string }> = {};
    const entryByKey = new Map<string, LinkedResourceEntry>();
    for (const row of rows) {
      locales[row.locale] = localeEntryOf(row);
      for (const [key, entry] of Object.entries(parseLinkedResourceEntries(row.linkedResources))) {
        if (!entryByKey.has(key)) entryByKey.set(key, entry);
      }
    }

    assertSystemFilesReadable(scope, entryByKey.values(), query.user.tenantId);

    const resources: TemplateBundle["resources"] = {};
    const pdfAttachments: TemplateBundle["pdfAttachments"] = {};
    for (const [key, entry] of entryByKey) {
      if (isPdfAttachmentLink(entry)) {
        pdfAttachments[key] = { templateSlug: entry.templateSlug, fileName: entry.fileName };
        continue;
      }
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
      pdfAttachments,
    };
  },
});
