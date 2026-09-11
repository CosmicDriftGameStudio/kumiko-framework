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
  description:
    "One tenant-editable public web page, unique per slug and language, holding a markdown body plus the title, SEO description and OG image, with a published flag that decides whether anonymous visitors are served it or get a 404.",
  fields: {
    slug: createTextField({
      required: true,
      maxLength: 64,
      sortable: true,
      searchable: true,
      personal: false,
      reason: "technical_reference",
    }),
    lang: createTextField({
      required: true,
      maxLength: 8,
      sortable: true,
      personal: false,
      reason: "technical_reference",
    }),
    title: createTextField({
      required: true,
      maxLength: 200,
      searchable: true,
      personal: false,
      reason: "is_business_data",
    }),
    // Body + description sind vom Tenant-Admin authored Business-Content
    // (Markdown), keine User-Generated-PII. `multiline` → der entityEdit-
    // Renderer gibt ein <textarea> aus (createLongTextField hat aktuell
    // einen Render-Gap: edit.ts/render-field.tsx gaten nur type==="text").
    // maxLengths spiegeln die Handler-Schemas (set.write + Convention-CRUD
    // leiten ihre zod-Caps aus diesen Field-maxLengths ab).
    body: createTextField({
      multiline: { rows: 16 },
      maxLength: 100_000,
      personal: false,
      reason: "is_business_data",
    }),
    description: createTextField({ maxLength: 500, personal: false, reason: "is_business_data" }),
    ogImage: createTextField({ maxLength: 2000, personal: false, reason: "is_business_data" }),
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
