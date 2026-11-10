import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { patchIssue } from "../document-op-blocks.ts";
import { composeLayoutHtml } from "../layout-regions.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import {
  refuseTemplateEdit,
  type TemplateEditPolicy,
  templateEditAccess,
} from "../template-edit-policy.ts";
import { resolveTemplateVariables } from "../template-validation.ts";
import { PDF_DEFAULT_FONT_SIZE_PT, TENANT_LAYOUT_SLUG_PREFIX } from "../web/constants.ts";
import { localeSchema, slugSchema, titleSchema } from "./shared.ts";
import { writeTemplateRow } from "./template-write.ts";

const PDF_LAYOUT_KIND = "pdf-layout" as const;

const STANDARD_LAYOUT_META = {
  fontFamily: "arial",
  fontSizePt: PDF_DEFAULT_FONT_SIZE_PT,
  tableStyle: "plain",
} as const;

export function makeCreateLayoutWrite(policy: TemplateEditPolicy) {
  return defineWriteHandler({
    name: "create-layout",
    schema: z.object({ name: slugSchema, title: titleSchema, locale: localeSchema }),
    access: templateEditAccess(policy.tenantEditable),
    agent: { risk: "low", effect: "proposal" },
    description:
      "Creates a new PDF layout of the caller's tenant as a draft under the slug tenant-layout-<name> (name is kebab-case) with empty header, signature and footer regions and the standard look (font, size, table style); it fails with layout_exists when the tenant already has that layout. A TenantAdmin may create layouts as soon as they may edit any PDF template; every other caller is refused. Returns the full slug, locale, kind and base ({scope, version}) for the next call. Next steps: fill the regions with patch-draft (kind pdf-layout, the returned slug, region header, signature or footer; setMeta changes margins, fontFamily, fontSizePt, textColor, tableStyle, tableHeaderBackground), then let a person publish the layout and point a PDF template at it with patch-draft setMeta {layoutSlug: <returned slug>}.",
    handler: async (event, ctx) => {
      const { name, title, locale } = event.payload;
      const slug = `${TENANT_LAYOUT_SLUG_PREFIX}${name}`;
      const refused = refuseTemplateEdit(policy, event.user, { slug, kind: PDF_LAYOUT_KIND });
      if (refused !== null) return refused;

      const existing = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
        tenantId: event.user.tenantId,
        slug,
        kind: PDF_LAYOUT_KIND,
      });
      if (existing !== undefined) {
        return writeFailure(
          new ValidationError({ fields: [patchIssue("name", "layout_exists", { slug })] }),
        );
      }

      const written = await writeTemplateRow({
        ctx,
        user: event.user,
        tenantId: event.user.tenantId,
        scope: "tenant",
        status: "draft",
        variables: resolveTemplateVariables(ctx.registry, slug, {}),
        payload: {
          slug,
          kind: PDF_LAYOUT_KIND,
          locale,
          content: composeLayoutHtml({ header: "", signature: "", footer: "" }),
          contentFormat: "html",
          variableSchema: {},
          meta: STANDARD_LAYOUT_META,
          title,
        },
        expectedVersion: null,
      });
      if (!written.isSuccess) return written;
      const created = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
        tenantId: event.user.tenantId,
        id: written.data.id,
      });
      if (created === undefined) throw new Error(`create-layout: row ${slug} missing after write`);
      return {
        isSuccess: true as const,
        data: {
          slug,
          locale,
          kind: PDF_LAYOUT_KIND,
          base: { scope: "tenant" as const, version: created.version },
        },
      };
    },
  });
}
