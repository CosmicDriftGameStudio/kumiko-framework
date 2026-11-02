import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { renderSafeMarkdown } from "../../page-render/index.ts";
import { documentViolationsToFieldIssues, sanitizeDocumentHtml } from "../document-sanitizer.ts";
import { type TemplateEditPolicy, templateEditAccess } from "../template-edit-policy.ts";

const BODY_PREVIEW_FORMATS = ["markdown", "document"] as const;

// One query behind the editors' "web" preview (page bodies and legal texts): both render
// through the same page-render markdown core and the document sanitizer. Nothing is cached, so a
// draft is always rendered fresh. The access is everyone who may write either kind of body: the
// roles editing text blocks (SystemAdmin plus the tenantEditable roles) and the TenantAdmin who
// writes managed pages.
export function makeBodyPreviewQuery(policy: TemplateEditPolicy) {
  return defineQueryHandler({
    name: "body-preview",
    schema: z.object({
      body: z.string().max(100_000).nullable(),
      bodyFormat: z.enum(BODY_PREVIEW_FORMATS).default("markdown"),
    }),
    access: {
      roles: [...new Set([...templateEditAccess(policy.tenantEditable).roles, "TenantAdmin"])],
    },
    description:
      "Renders an unsaved body (Markdown or editor document, per bodyFormat) to the sanitized HTML a public page serves for it, without saving anything and without the site's header and footer; a document body the write rules reject is answered with the same field errors on body as a save.",
    handler: async (query) => {
      const { body, bodyFormat } = query.payload;
      if (body === null || body === "") return { html: "" };
      if (bodyFormat === "markdown") return { html: renderSafeMarkdown(body) };
      const sanitized = sanitizeDocumentHtml(body);
      if (sanitized.ok) return { html: sanitized.html };
      throw new ValidationError({
        fields: documentViolationsToFieldIssues(sanitized.violations).map((issue) => ({
          ...issue,
          path: "body",
        })),
      });
    },
  });
}
