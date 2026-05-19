import { buildDrizzleTable } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createLongTextField,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  CONTENT_FORMATS,
  RENDER_KINDS,
  TEMPLATE_SCOPES,
  TEMPLATE_STATUSES,
} from "./constants";

// TemplateResource — strukturierte Template-Definition mit Tenant-
// Override-Hierarchie, Locale-Fallback und Resource-Linking via
// file-foundation. Pro (tenantId, slug, kind, locale) genau eine Row;
// scope/status/version differenzieren Lifecycle.
//
// `variableSchema` + `linkedResources` sind JSON-Strings in longText
// (Pattern aus compliance-profiles — kein dedizierter jsonbField im
// createEntity-DSL). App-Layer parsed JSON, persistiert wieder als String.
export const templateResourceEntity = createEntity({
  table: "read_template_resources",
  fields: {
    slug: createTextField({ required: true }),
    kind: createSelectField({ required: true, options: [...RENDER_KINDS] }),
    locale: createTextField({ required: true }),
    content: createLongTextField({}),
    contentFormat: createSelectField({ required: true, options: [...CONTENT_FORMATS] }),
    variableSchema: createLongTextField({}),
    linkedResources: createLongTextField({}),
    scope: createSelectField({ required: true, options: [...TEMPLATE_SCOPES] }),
    parentTemplateId: createTextField({}),
    status: createSelectField({ required: true, options: [...TEMPLATE_STATUSES] }),
  },
  indexes: [
    {
      unique: true,
      columns: ["tenantId", "slug", "kind", "locale"],
      name: "read_template_resources_unique",
    },
  ],
});

export const templateResourcesTable = buildDrizzleTable(
  "template-resource",
  templateResourceEntity,
);

// Concrete Row-Type — single-source dafür dass die unknown-Werte die
// Drizzle aus `Record<string, unknown>` liefert genau einmal benannt
// werden (statt 12× `row["x"] as Y` Casts in Handlern + Resolver).
export type TemplateResourceRow = {
  readonly id: string | number;
  readonly version: number;
  readonly tenantId: string;
  readonly slug: string;
  readonly kind: string;
  readonly locale: string;
  readonly content: string | null;
  readonly contentFormat: string;
  readonly variableSchema: string | null;
  readonly linkedResources: string | null;
  readonly scope: string;
  readonly parentTemplateId: string | null;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: string;
  readonly updatedBy: string;
};
