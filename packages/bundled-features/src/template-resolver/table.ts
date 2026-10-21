import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createNumberField,
  createSelectField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";
import type { EntityEventMigration } from "@cosmicdrift/kumiko-types/fields";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  CONTENT_FORMATS,
  TEMPLATE_KINDS,
  TEMPLATE_SCOPES,
  TEMPLATE_STATUSES,
} from "./web/constants.ts";

// Stored v1 events name the kind "mail-html", which is now "mail".
const renameMailHtmlKind: EntityEventMigration = {
  fromVersion: 1,
  toVersion: 2,
  transform: (fields) => (fields["kind"] === "mail-html" ? { ...fields, kind: "mail" } : fields),
};

// TemplateResource — structured template definition with tenant override
// hierarchy, locale fallback, and resource linking via file-foundation. Exactly
// one row per (tenantId, slug, kind, locale); scope/status/version distinguish
// lifecycle states. The draft alongside an active revision is stored in `draft`;
// the main fields remain the served revision.
//
// `variableSchema` + `linkedResources` are JSON strings in longText
// (following compliance-profiles because the createEntity DSL has no dedicated
// jsonbField). The application layer parses the JSON and persists it as a string.
export const templateResourceEntity = createEntity({
  table: "read_template_resources",
  fields: {
    slug: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    kind: createSelectField({ required: true, options: [...TEMPLATE_KINDS] }),
    locale: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    // Human-facing heading for kind="text-block" (legal pages, marketing
    // copy). Nullable because render templates carry their subject inside
    // the body; a NOT NULL here would break every existing mail row.
    // Same authorship class as `content` below.
    title: createTextField({ personal: false, reason: "is_business_data" }),
    // Folder path for the content tree, `/`-separated ("page/marketing").
    // null = root node.
    folder: createTextField({ personal: false, reason: "technical_reference" }),
    // Template body is authored by TenantAdmin/Operator (email-templates, etc.),
    // and is business data—not end-user UGC.
    content: createLongTextField({
      personal: false,
      reason: "is_business_data",
    }),
    contentFormat: createSelectField({ required: true, options: [...CONTENT_FORMATS] }),
    variableSchema: createLongTextField({ personal: false, reason: "technical_reference" }),
    linkedResources: createLongTextField({ personal: false, reason: "technical_reference" }),
    // Per-kind JSON (mail: subject, preview text, layout slug, ...), validated
    // against template-meta.ts on write. Authored by TenantAdmin/Operator.
    meta: createLongTextField({ personal: false, reason: "is_business_data" }),
    scope: createSelectField({ required: true, options: [...TEMPLATE_SCOPES] }),
    parentTemplateId: createTextField({ personal: false, reason: "technical_reference" }),
    status: createSelectField({ required: true, options: [...TEMPLATE_STATUSES] }),
    // JSON of the unpublished edit beside the active version (see template-draft.ts).
    draft: createLongTextField({ personal: false, reason: "is_business_data" }),
    // `version` counts every save including drafts; these two describe the served version.
    activeVersion: createNumberField({ integer: true, min: 1 }),
    activeSince: createTimestampField({}),
  },
  indexes: [
    {
      unique: true,
      columns: ["tenantId", "slug", "kind", "locale"],
      name: "read_template_resources_unique",
    },
  ],
  eventVersion: 2,
  eventMigrations: [renameMailHtmlKind],
});

export const templateResourcesTable = buildEntityTable("template-resource", templateResourceEntity);

// Base columns buildEntityTable adds to every entity table. modifiedAt/By stay
// null until the first update; inserts only set insertedAt/By.
export type EntityAuditColumns = {
  readonly insertedAt: Temporal.Instant;
  readonly modifiedAt: Temporal.Instant | null;
  readonly insertedById: string | null;
  readonly modifiedById: string | null;
};

// Concrete row type—the single source of truth for naming the unknown values
// returned by Drizzle from `Record<string, unknown>` (instead of 12×
// `row["x"] as Y` casts in handlers and resolvers).
export type TemplateResourceRow = {
  readonly id: string | number;
  readonly version: number;
  readonly tenantId: string;
  readonly slug: string;
  readonly kind: string;
  readonly locale: string;
  readonly title: string | null;
  readonly folder: string | null;
  readonly content: string | null;
  readonly contentFormat: string;
  readonly variableSchema: string | null;
  readonly linkedResources: string | null;
  readonly meta: string | null;
  readonly scope: string;
  readonly parentTemplateId: string | null;
  readonly status: string;
  readonly draft: string | null;
  readonly activeVersion: number | null;
  readonly activeSince: Temporal.Instant | null;
} & EntityAuditColumns;
