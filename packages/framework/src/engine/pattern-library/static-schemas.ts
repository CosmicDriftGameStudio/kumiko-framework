// Static pattern schemas (form-only, no closures).

import { CLAIM_KEY_TYPE_OPTIONS, ID_TYPE_OPTIONS } from "./shared-fields";
import type { PatternFormSchema } from "./types";

// --- Static patterns (form-only, no closures) -----------------------------

export const requiresSchema: PatternFormSchema = {
  kind: "requires",
  label: { en: "Requires", de: "Benötigt" },
  summary: { en: "Hard dependency on other features." },
  category: "meta",
  editability: "static",
  singleton: true,
  fields: [
    {
      path: "featureNames",
      label: { en: "Feature names", de: "Feature-Namen" },
      input: "string-list",
      itemPlaceholder: "auth",
      required: true,
    },
  ],
};

export const optionalRequiresSchema: PatternFormSchema = {
  kind: "optionalRequires",
  label: { en: "Optional requires", de: "Optional benötigt" },
  summary: { en: "Soft dependency — used if available, otherwise skipped." },
  category: "meta",
  editability: "static",
  singleton: true,
  fields: [
    {
      path: "featureNames",
      label: { en: "Feature names", de: "Feature-Namen" },
      input: "string-list",
      itemPlaceholder: "analytics",
    },
  ],
};

export const readsConfigSchema: PatternFormSchema = {
  kind: "readsConfig",
  label: { en: "Reads config", de: "Liest Config" },
  summary: { en: "Declares which qualified config keys this feature reads." },
  category: "meta",
  editability: "static",
  singleton: true,
  fields: [
    {
      path: "qualifiedKeys",
      label: { en: "Qualified keys", de: "Qualifizierte Keys" },
      input: "string-list",
      itemPlaceholder: "billing:plan",
    },
  ],
};

export const systemScopeSchema: PatternFormSchema = {
  kind: "systemScope",
  label: { en: "System scope", de: "System-Scope" },
  summary: { en: "Marks this feature as system-tenant only." },
  category: "meta",
  editability: "static",
  singleton: true,
  fields: [],
};

export const toggleableSchema: PatternFormSchema = {
  kind: "toggleable",
  label: { en: "Toggleable", de: "Umschaltbar" },
  summary: { en: "Operator can switch this feature on/off per tenant." },
  category: "meta",
  editability: "static",
  singleton: true,
  fields: [
    {
      path: "default",
      label: { en: "Enabled by default", de: "Standardmäßig aktiviert" },
      input: "boolean",
      required: true,
    },
  ],
};

export const describeSchema: PatternFormSchema = {
  kind: "describe",
  label: { en: "Description", de: "Beschreibung" },
  summary: { en: "One-to-three-sentence docs-lead: what the feature does + when you need it." },
  category: "meta",
  editability: "static",
  singleton: true,
  fields: [
    {
      path: "text",
      label: { en: "Text", de: "Text" },
      input: "textarea",
      required: true,
      placeholder: "Stores per-tenant widgets and exposes CRUD handlers for them.",
    },
  ],
};

export const uiHintsSchema: PatternFormSchema = {
  kind: "uiHints",
  label: { en: "UI hints", de: "UI-Hinweise" },
  summary: { en: "Picker/scaffolder metadata. Opaque to the Designer; rendered as raw TS source." },
  category: "meta",
  editability: "opaque",
  singleton: true,
  fields: [],
};

export const entitySchema: PatternFormSchema = {
  kind: "entity",
  label: { en: "Entity", de: "Entität" },
  summary: { en: "An aggregate stored as event-sourced read-model." },
  category: "data",
  editability: "static",
  fields: [
    {
      path: "entityName",
      label: { en: "Name", de: "Name" },
      input: "text",
      required: true,
      placeholder: "task",
    },
    {
      path: "definition.fields",
      label: { en: "Fields", de: "Felder" },
      input: "entity-fields-editor",
      required: true,
    },
    {
      path: "definition.idType",
      label: { en: "ID type", de: "ID-Typ" },
      input: "select",
      options: ID_TYPE_OPTIONS,
    },
    {
      path: "definition.softDelete",
      label: { en: "Soft delete", de: "Soft-Delete" },
      hint: { en: "Mark rows isDeleted=true instead of removing them." },
      input: "boolean",
    },
    {
      path: "definition.table",
      label: { en: "Table name (override)", de: "Tabellenname (Override)" },
      hint: { en: "Defaults to read_<plural-snake-case-name>." },
      input: "text",
    },
  ],
};

export const relationSchema: PatternFormSchema = {
  kind: "relation",
  label: { en: "Relation", de: "Beziehung" },
  summary: { en: "Foreign-key relationship between entities." },
  category: "data",
  editability: "static",
  fields: [
    {
      path: "entityName",
      label: { en: "Owner entity", de: "Besitzende Entität" },
      input: "entity-ref",
      required: true,
    },
    {
      path: "relationName",
      label: { en: "Relation name", de: "Beziehungs-Name" },
      input: "text",
      required: true,
      placeholder: "owner",
    },
    {
      path: "definition",
      label: { en: "Type", de: "Typ" },
      input: "discriminated-union",
      discriminator: "type",
      variants: [
        {
          tag: "belongsTo",
          label: { en: "Belongs to", de: "Gehört zu" },
          fields: [
            {
              path: "definition.target",
              label: { en: "Target entity", de: "Ziel-Entität" },
              input: "entity-ref",
              required: true,
            },
            {
              path: "definition.foreignKey",
              label: { en: "Foreign key column", de: "FK-Spalte" },
              input: "text",
              required: true,
            },
          ],
        },
        {
          tag: "hasMany",
          label: { en: "Has many", de: "Hat viele" },
          fields: [
            {
              path: "definition.target",
              label: { en: "Target entity", de: "Ziel-Entität" },
              input: "entity-ref",
              required: true,
            },
          ],
        },
        {
          tag: "manyToMany",
          label: { en: "Many to many", de: "Viele zu viele" },
          fields: [
            {
              path: "definition.target",
              label: { en: "Target entity", de: "Ziel-Entität" },
              input: "entity-ref",
              required: true,
            },
          ],
        },
      ],
    },
  ],
};

export const navSchema: PatternFormSchema = {
  kind: "nav",
  label: { en: "Navigation entry", de: "Navigations-Eintrag" },
  summary: { en: "Side-bar / menu link." },
  category: "ui",
  editability: "static",
  fields: [
    {
      path: "definition.id",
      label: { en: "ID", de: "ID" },
      input: "text",
      required: true,
    },
    {
      path: "definition.label",
      label: { en: "Label", de: "Beschriftung" },
      input: "text",
    },
    {
      path: "definition.screen",
      label: { en: "Screen QN", de: "Screen-QN" },
      hint: { en: "<feature>:screen:<id> qualified name." },
      input: "text",
    },
    {
      path: "definition.parent",
      label: { en: "Parent nav", de: "Eltern-Nav" },
      input: "text",
    },
  ],
};

export const workspaceSchema: PatternFormSchema = {
  kind: "workspace",
  label: { en: "Workspace", de: "Arbeitsbereich" },
  summary: { en: "Persona-/role-scoped UI surface." },
  category: "ui",
  editability: "static",
  fields: [
    {
      path: "definition.id",
      label: { en: "ID", de: "ID" },
      input: "text",
      required: true,
    },
    {
      path: "definition.label",
      label: { en: "Label", de: "Beschriftung" },
      input: "text",
    },
  ],
};

export const configSchema: PatternFormSchema = {
  kind: "config",
  label: { en: "Config keys", de: "Config-Keys" },
  summary: { en: "Typed runtime configuration." },
  category: "meta",
  editability: "static",
  singleton: true,
  fields: [
    {
      path: "keys",
      label: { en: "Keys", de: "Keys" },
      input: "key-value-map",
      keyPlaceholder: "maxItems",
      valueInput: "json-readonly",
      required: true,
    },
  ],
};

export const translationsSchema: PatternFormSchema = {
  kind: "translations",
  label: { en: "Translations", de: "Übersetzungen" },
  summary: { en: "i18n strings keyed by locale." },
  category: "meta",
  editability: "static",
  singleton: true,
  fields: [
    {
      path: "keys",
      label: { en: "Locales", de: "Sprachen" },
      input: "key-value-map",
      keyPlaceholder: "en",
      valueInput: "json-readonly",
      required: true,
    },
  ],
};

export const metricSchema: PatternFormSchema = {
  kind: "metric",
  label: { en: "Metric", de: "Metrik" },
  summary: { en: "Prometheus-style counter / gauge / histogram." },
  category: "meta",
  editability: "static",
  fields: [
    {
      path: "shortName",
      label: { en: "Short name", de: "Kurzname" },
      hint: { en: "Snake-case; auto-prefixed with kumiko_<feature>_." },
      input: "text",
      required: true,
    },
    {
      path: "options.type",
      label: { en: "Type", de: "Typ" },
      input: "select",
      options: [
        { value: "counter", label: { en: "Counter" } },
        { value: "gauge", label: { en: "Gauge" } },
        { value: "histogram", label: { en: "Histogram" } },
      ],
      required: true,
    },
  ],
};

export const secretSchema: PatternFormSchema = {
  kind: "secret",
  label: { en: "Secret", de: "Secret" },
  summary: { en: "Tenant-scoped encrypted credential." },
  category: "meta",
  editability: "static",
  fields: [
    {
      path: "shortName",
      label: { en: "Short name", de: "Kurzname" },
      input: "text",
      required: true,
    },
    {
      path: "options.label",
      label: { en: "UI label (i18n)", de: "UI-Label (i18n)" },
      hint: { en: "{ en: 'API Key', de: 'API-Schlüssel' }" },
      input: "json-readonly",
      required: true,
    },
    {
      path: "options.scope",
      label: { en: "Scope", de: "Geltungsbereich" },
      input: "select",
      options: [
        { value: "tenant", label: { en: "Tenant" } },
        { value: "system", label: { en: "System" } },
      ],
    },
  ],
};

export const claimKeySchema: PatternFormSchema = {
  kind: "claimKey",
  label: { en: "Claim key", de: "Claim-Key" },
  summary: { en: "Typed JWT claim contributed at login." },
  category: "meta",
  editability: "static",
  fields: [
    {
      path: "shortName",
      label: { en: "Short name", de: "Kurzname" },
      input: "text",
      required: true,
    },
    {
      path: "claimType",
      label: { en: "Type", de: "Typ" },
      input: "select",
      options: CLAIM_KEY_TYPE_OPTIONS,
      required: true,
    },
  ],
};

export const referenceDataSchema: PatternFormSchema = {
  kind: "referenceData",
  label: { en: "Reference data", de: "Referenzdaten" },
  summary: { en: "Seed data for an entity (currencies, categories, …)." },
  category: "data",
  editability: "static",
  fields: [
    {
      path: "entityName",
      label: { en: "Entity", de: "Entität" },
      input: "entity-ref",
      required: true,
    },
    {
      path: "data",
      label: { en: "Rows", de: "Zeilen" },
      input: "json-readonly",
      required: true,
    },
    {
      path: "upsertKey",
      label: { en: "Upsert key", de: "Upsert-Key" },
      hint: { en: "Field name to deduplicate on." },
      input: "text",
    },
  ],
};

export const useExtensionSchema: PatternFormSchema = {
  kind: "useExtension",
  label: { en: "Use extension", de: "Erweiterung nutzen" },
  summary: { en: "Apply a registered registrar-extension to an entity." },
  category: "advanced",
  editability: "static",
  fields: [
    {
      path: "extensionName",
      label: { en: "Extension name", de: "Erweiterungs-Name" },
      input: "text",
      required: true,
    },
    {
      path: "entityName",
      label: { en: "Entity", de: "Entität" },
      input: "entity-ref",
      required: true,
    },
    {
      path: "options",
      label: { en: "Options", de: "Optionen" },
      input: "json-readonly",
    },
  ],
};
