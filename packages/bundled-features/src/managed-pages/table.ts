import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createBooleanField,
  createEntity,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import { BODY_FORMATS, type BodyFormat, DEFAULT_BODY_FORMAT } from "./constants.ts";

// Page — a tenant-editable, server-rendered public page (landing,
// about, custom). Exactly one row per (tenantId, slug, lang). The body is
// Markdown or an editor document (bodyFormat), rendered securely on the server. `published`
// gates delivery to anonymous visitors: drafts return 404. description and
// ogImage support SEO and social previews. SYSTEM_TENANT_ID is used for
// app-wide pages; otherwise the page belongs to the tenant resolved from the
// host via resolveApexTenant during rendering.
export const pageEntity = createEntity({
  table: "read_pages",
  description:
    "One tenant-editable public web page, unique per slug and language, holding a markdown or document (HTML) body plus the title, SEO description and OG image, with a published flag that decides whether anonymous visitors are served it or get a 404.",
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
    // Body and description are tenant-admin-authored business content
    // (Markdown), not user-generated PII. `multiline` makes the entityEdit
    // renderer output a <textarea> (createLongTextField currently has a
    // rendering gap: edit.ts/render-field.tsx only gates on type==="text").
    // maxLengths mirror the handler schemas (set.write and convention CRUD
    // derive their zod caps from these field maxLengths).
    body: createTextField({
      multiline: { rows: 16 },
      maxLength: 100_000,
      personal: false,
      reason: "is_business_data",
    }),
    bodyFormat: createSelectField({ options: BODY_FORMATS, default: DEFAULT_BODY_FORMAT }),
    description: createTextField({ maxLength: 500, personal: false, reason: "is_business_data" }),
    ogImage: createTextField({ maxLength: 2000, personal: false, reason: "is_business_data" }),
    published: createBooleanField({ default: false }),
  },
  indexes: [{ unique: true, columns: ["tenantId", "slug", "lang"], name: "read_pages_unique" }],
});

export const pagesTable = buildEntityTable("page", pageEntity);

// Concrete row type — the single source of truth for named values instead
// of `row["x"] as Y` casts in handlers. Includes entity.fields and standard
// columns (id, version, tenantId, createdAt, updatedAt, createdBy, updatedBy).
export type PageRow = {
  readonly id: string;
  readonly version: number;
  readonly tenantId: string;
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body: string | null;
  readonly bodyFormat: BodyFormat | null;
  readonly description: string | null;
  readonly ogImage: string | null;
  readonly published: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string;
  readonly updatedBy: string;
};
