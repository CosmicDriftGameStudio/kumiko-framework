import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

// Page — vom Tenant editierbare, server-gerenderte Public-Page (Landing,
// About, custom). Pro (tenantId, slug, lang) genau eine Row. Body ist
// Markdown (gehärtet server-gerendert über page-render). `published` gated
// die Auslieferung an anonyme Besucher: Drafts → 404. description/ogImage
// für SEO + Social-Preview. SYSTEM_TENANT_ID für app-weite Pages, sonst
// Tenant-eigene Pages (Host → tenantId via resolveApexTenant am Render-Pfad).
export const pageEntity = createEntity({
  table: "read_pages",
  fields: {
    slug: createTextField({ required: true }),
    lang: createTextField({ required: true }),
    title: createTextField({ required: true }),
    // Body + description sind vom Tenant-Admin authored Business-Content
    // (Markdown), keine User-Generated-PII.
    body: createTextField({ allowPlaintext: "is-business-data" }),
    description: createTextField({ allowPlaintext: "is-business-data" }),
    ogImage: createTextField({}),
    published: createBooleanField({ default: false }),
  },
  indexes: [{ unique: true, columns: ["tenantId", "slug", "lang"], name: "read_pages_unique" }],
});

export const pagesTable = buildEntityTable("page", pageEntity);

// Concrete Row-Type — single-source für die benannten Werte (statt
// `row["x"] as Y`-Casts in Handlern). entity.fields + Standard-Spalten
// (id, version, tenantId, createdAt, updatedAt, createdBy, updatedBy).
export type PageRow = {
  readonly id: string;
  readonly version: number;
  readonly tenantId: string;
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body: string | null;
  readonly description: string | null;
  readonly ogImage: string | null;
  readonly published: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string;
  readonly updatedBy: string;
};
