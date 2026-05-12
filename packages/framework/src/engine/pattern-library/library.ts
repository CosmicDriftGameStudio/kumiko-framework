// Pattern-Library — concrete FormSchema entries for every FeaturePattern
// kind. Centralised here so the Designer (C5/C6), the AI-Builder (L2),
// and the MCP-Server (L9) share one source-of-truth for "how does this
// pattern look as a form?".
//
// **Updating contract:** when a new pattern-kind gets a parser/renderer
// extension, add a matching entry here. The exhaustiveness test
// (pattern-library.test.ts) catches missing kinds at CI time.
//
// **Path stability:** every `path` references a property of the parsed
// FeaturePattern shape. When the pattern type changes (new field added
// to e.g. EntityPattern.definition), update both the renderer in
// render.ts AND the library here — paths are part of the public API
// the Designer/LLM relies on.

import type { FeaturePatternKind } from "../feature-ast/patterns";
import type { FormFieldSpec, PatternCategory, PatternFormSchema } from "./types";

// =============================================================================
// Reusable field building blocks
// =============================================================================

const HOOK_TYPE_OPTIONS = [
  { value: "validation", label: { en: "Validation", de: "Validierung" } },
  { value: "preSave", label: { en: "Pre-Save", de: "Vor Speichern" } },
  { value: "postSave", label: { en: "Post-Save", de: "Nach Speichern" } },
  { value: "preDelete", label: { en: "Pre-Delete", de: "Vor Löschen" } },
  { value: "postDelete", label: { en: "Post-Delete", de: "Nach Löschen" } },
  { value: "preQuery", label: { en: "Pre-Query", de: "Vor Abfrage" } },
] as const;

const ENTITY_HOOK_TYPE_OPTIONS = [
  { value: "postSave", label: { en: "Post-Save", de: "Nach Speichern" } },
  { value: "preDelete", label: { en: "Pre-Delete", de: "Vor Löschen" } },
  { value: "postDelete", label: { en: "Post-Delete", de: "Nach Löschen" } },
] as const;

const HTTP_METHOD_OPTIONS = [
  { value: "GET", label: { en: "GET" } },
  { value: "POST", label: { en: "POST" } },
  { value: "PUT", label: { en: "PUT" } },
  { value: "PATCH", label: { en: "PATCH" } },
  { value: "DELETE", label: { en: "DELETE" } },
  { value: "HEAD", label: { en: "HEAD" } },
  { value: "OPTIONS", label: { en: "OPTIONS" } },
] as const;

const CLAIM_KEY_TYPE_OPTIONS = [
  { value: "string", label: { en: "string" } },
  { value: "number", label: { en: "number" } },
  { value: "boolean", label: { en: "boolean" } },
  { value: "string[]", label: { en: "string[]" } },
  { value: "object", label: { en: "object" } },
] as const;

const ID_TYPE_OPTIONS = [
  { value: "uuid", label: { en: "UUID (default)", de: "UUID (Standard)" } },
  { value: "serial", label: { en: "Serial integer", de: "Serial Integer" } },
] as const;

const accessRuleField: FormFieldSpec = {
  path: "access",
  label: { en: "Access", de: "Zugriff" },
  hint: { en: "Either a list of role names or `openToAll`." },
  input: "discriminated-union",
  discriminator: "type",
  variants: [
    {
      tag: "roles",
      label: { en: "Role-based", de: "Rollen-basiert" },
      fields: [
        {
          path: "access.roles",
          label: { en: "Roles", de: "Rollen" },
          input: "string-list",
          itemPlaceholder: "Admin",
        },
      ],
    },
    {
      tag: "openToAll",
      label: { en: "Open to all (auth still required)", de: "Für alle (Auth nötig)" },
      fields: [
        {
          path: "access.openToAll",
          label: { en: "Open to all", de: "Offen für alle" },
          input: "boolean",
        },
      ],
    },
  ],
};

// =============================================================================
// Pattern schemas
// =============================================================================

// --- Static patterns (form-only, no closures) -----------------------------

const requiresSchema: PatternFormSchema = {
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

const optionalRequiresSchema: PatternFormSchema = {
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

const readsConfigSchema: PatternFormSchema = {
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

const systemScopeSchema: PatternFormSchema = {
  kind: "systemScope",
  label: { en: "System scope", de: "System-Scope" },
  summary: { en: "Marks this feature as system-tenant only." },
  category: "meta",
  editability: "static",
  singleton: true,
  fields: [],
};

const toggleableSchema: PatternFormSchema = {
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

const entitySchema: PatternFormSchema = {
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

const relationSchema: PatternFormSchema = {
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

const navSchema: PatternFormSchema = {
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

const workspaceSchema: PatternFormSchema = {
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

const configSchema: PatternFormSchema = {
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

const translationsSchema: PatternFormSchema = {
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

const metricSchema: PatternFormSchema = {
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

const secretSchema: PatternFormSchema = {
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

const claimKeySchema: PatternFormSchema = {
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

const referenceDataSchema: PatternFormSchema = {
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

const useExtensionSchema: PatternFormSchema = {
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

// --- Mixed patterns (header form + opaque body source) --------------------

const screenSchema: PatternFormSchema = {
  kind: "screen",
  label: { en: "Screen", de: "Bildschirm" },
  summary: { en: "List / edit / detail / custom UI surface." },
  category: "ui",
  editability: "mixed",
  fields: [
    {
      path: "definition.id",
      label: { en: "ID", de: "ID" },
      input: "text",
      required: true,
    },
    {
      path: "definition.type",
      label: { en: "Type", de: "Typ" },
      input: "select",
      options: [
        { value: "entityList", label: { en: "Entity list" } },
        { value: "entityEdit", label: { en: "Entity edit" } },
        { value: "actionForm", label: { en: "Action form" } },
        { value: "custom", label: { en: "Custom" } },
      ],
      required: true,
    },
    {
      path: "definition",
      label: { en: "Definition", de: "Definition" },
      hint: { en: "Full ScreenDefinition — closures show as code-blocks." },
      input: "json-readonly",
    },
    {
      path: "opaqueProps",
      label: { en: "Closure paths", de: "Closure-Pfade" },
      hint: { en: "JSON-paths whose values are inline closures." },
      input: "json-readonly",
      readOnly: true,
    },
  ],
};

const writeHandlerSchema: PatternFormSchema = {
  kind: "writeHandler",
  label: { en: "Write handler", de: "Write-Handler" },
  summary: { en: "Mutation endpoint with Zod schema + closure body." },
  category: "behaviour",
  editability: "mixed",
  fields: [
    {
      path: "handlerName",
      label: { en: "Name", de: "Name" },
      input: "text",
      required: true,
      placeholder: "task:create",
    },
    {
      path: "schemaSource",
      label: { en: "Zod schema (source)", de: "Zod-Schema (Source)" },
      input: "code-block",
      language: "zod",
      readOnly: true,
    },
    {
      path: "handlerBody",
      label: { en: "Handler body (source)", de: "Handler-Body (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
    accessRuleField,
    {
      path: "rateLimit",
      label: { en: "Rate limit", de: "Rate-Limit" },
      input: "json-readonly",
    },
    {
      path: "skipTransitionGuard",
      label: { en: "Skip transition guard", de: "Übergangs-Guard überspringen" },
      input: "boolean",
    },
  ],
};

const queryHandlerSchema: PatternFormSchema = {
  kind: "queryHandler",
  label: { en: "Query handler", de: "Query-Handler" },
  summary: { en: "Read endpoint with Zod schema + closure body." },
  category: "behaviour",
  editability: "mixed",
  fields: [
    {
      path: "handlerName",
      label: { en: "Name", de: "Name" },
      input: "text",
      required: true,
      placeholder: "task:list",
    },
    {
      path: "schemaSource",
      label: { en: "Zod schema (source)", de: "Zod-Schema (Source)" },
      input: "code-block",
      language: "zod",
      readOnly: true,
    },
    {
      path: "handlerBody",
      label: { en: "Handler body (source)", de: "Handler-Body (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
    accessRuleField,
    {
      path: "rateLimit",
      label: { en: "Rate limit", de: "Rate-Limit" },
      input: "json-readonly",
    },
  ],
};

const hookSchema: PatternFormSchema = {
  kind: "hook",
  label: { en: "Lifecycle hook", de: "Lifecycle-Hook" },
  summary: { en: "Pre-/post-save/delete/query hook on one or more entities." },
  category: "behaviour",
  editability: "mixed",
  fields: [
    {
      path: "hookType",
      label: { en: "Type", de: "Typ" },
      input: "select",
      options: HOOK_TYPE_OPTIONS,
      required: true,
    },
    {
      path: "target",
      label: { en: "Target entity (or list)", de: "Ziel-Entität (oder Liste)" },
      input: "json-readonly",
      required: true,
    },
    {
      path: "fnBody",
      label: { en: "Hook body (source)", de: "Hook-Body (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
    {
      path: "phase",
      label: { en: "Phase", de: "Phase" },
      input: "select",
      options: [
        { value: "inTransaction", label: { en: "In transaction" } },
        { value: "afterCommit", label: { en: "After commit" } },
      ],
    },
  ],
};

const entityHookSchema: PatternFormSchema = {
  kind: "entityHook",
  label: { en: "Entity hook", de: "Entity-Hook" },
  summary: { en: "Hook scoped to a single entity (no cross-entity targets)." },
  category: "behaviour",
  editability: "mixed",
  fields: [
    {
      path: "hookType",
      label: { en: "Type", de: "Typ" },
      input: "select",
      options: ENTITY_HOOK_TYPE_OPTIONS,
      required: true,
    },
    {
      path: "entityName",
      label: { en: "Entity", de: "Entität" },
      input: "entity-ref",
      required: true,
    },
    {
      path: "fnBody",
      label: { en: "Hook body (source)", de: "Hook-Body (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
    {
      path: "phase",
      label: { en: "Phase", de: "Phase" },
      input: "select",
      options: [
        { value: "inTransaction", label: { en: "In transaction" } },
        { value: "afterCommit", label: { en: "After commit" } },
      ],
    },
  ],
};

const jobSchema: PatternFormSchema = {
  kind: "job",
  label: { en: "Job", de: "Job" },
  summary: { en: "Scheduled background job (cron / interval)." },
  category: "background",
  editability: "mixed",
  fields: [
    {
      path: "jobName",
      label: { en: "Name", de: "Name" },
      input: "text",
      required: true,
    },
    {
      path: "options",
      label: { en: "Options", de: "Optionen" },
      hint: { en: "Schedule, idempotencyKey, runIn, …" },
      input: "json-readonly",
    },
    {
      path: "handlerBody",
      label: { en: "Handler body (source)", de: "Handler-Body (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
  ],
};

const notificationSchema: PatternFormSchema = {
  kind: "notification",
  label: { en: "Notification", de: "Benachrichtigung" },
  summary: { en: "Trigger → recipient/data/template pipeline." },
  category: "cross-cutting",
  editability: "mixed",
  fields: [
    {
      path: "notificationName",
      label: { en: "Name", de: "Name" },
      input: "text",
      required: true,
    },
    {
      path: "trigger.on",
      label: { en: "Trigger on entity", de: "Trigger-Entität" },
      input: "entity-ref",
      required: true,
    },
    {
      path: "recipientBody",
      label: { en: "Recipient (source)", de: "Empfänger (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
    {
      path: "dataBody",
      label: { en: "Data (source)", de: "Daten (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
    {
      path: "templates",
      label: { en: "Templates per channel", de: "Templates pro Kanal" },
      input: "key-value-map",
      keyPlaceholder: "email",
      valueInput: "code-block",
    },
  ],
};

const authClaimsSchema: PatternFormSchema = {
  kind: "authClaims",
  label: { en: "Auth claims hook", de: "Auth-Claims-Hook" },
  summary: { en: "Contributes claims into SessionUser at login." },
  category: "cross-cutting",
  editability: "opaque",
  singleton: true,
  fields: [
    {
      path: "fnBody",
      label: { en: "Handler body (source)", de: "Handler-Body (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
  ],
};

const httpRouteSchema: PatternFormSchema = {
  kind: "httpRoute",
  label: { en: "HTTP route", de: "HTTP-Route" },
  summary: { en: "Custom HTTP endpoint outside the dispatcher." },
  category: "cross-cutting",
  editability: "mixed",
  fields: [
    {
      path: "method",
      label: { en: "Method", de: "Methode" },
      input: "select",
      options: HTTP_METHOD_OPTIONS,
      required: true,
    },
    {
      path: "path",
      label: { en: "Path", de: "Pfad" },
      input: "text",
      required: true,
      placeholder: "/health",
    },
    {
      path: "anonymous",
      label: { en: "Anonymous (no auth)", de: "Anonym (keine Auth)" },
      input: "boolean",
    },
    {
      path: "handlerBody",
      label: { en: "Handler body (source)", de: "Handler-Body (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
  ],
};

const projectionSchema: PatternFormSchema = {
  kind: "projection",
  label: { en: "Projection", de: "Projection" },
  summary: { en: "Single-stream read-model in-TX with the source aggregate." },
  category: "background",
  editability: "mixed",
  fields: [
    {
      path: "name",
      label: { en: "Name", de: "Name" },
      input: "text",
      required: true,
    },
    {
      path: "sourceEntity",
      label: { en: "Source entity (or list)", de: "Quell-Entität (oder Liste)" },
      input: "json-readonly",
      required: true,
    },
    {
      path: "applyBodies",
      label: { en: "Apply per event-type", de: "Apply pro Event-Type" },
      input: "key-value-map",
      keyPlaceholder: "feature:event:type",
      valueInput: "code-block",
      required: true,
    },
  ],
};

const multiStreamProjectionSchema: PatternFormSchema = {
  kind: "multiStreamProjection",
  label: { en: "Multi-stream projection", de: "Multi-Stream-Projection" },
  summary: { en: "Async cross-aggregate read-model." },
  category: "background",
  editability: "mixed",
  fields: [
    {
      path: "name",
      label: { en: "Name", de: "Name" },
      input: "text",
      required: true,
    },
    {
      path: "applyBodies",
      label: { en: "Apply per event-type", de: "Apply pro Event-Type" },
      input: "key-value-map",
      keyPlaceholder: "feature:event:type",
      valueInput: "code-block",
      required: true,
    },
    {
      path: "errorMode",
      label: { en: "Error mode", de: "Fehler-Modus" },
      input: "select",
      options: [
        { value: "skip", label: { en: "Skip" } },
        { value: "halt", label: { en: "Halt" } },
        { value: "dead-letter", label: { en: "Dead-letter" } },
      ],
    },
    {
      path: "runIn",
      label: { en: "Run in", de: "Läuft in" },
      input: "select",
      options: [
        { value: "tenant", label: { en: "Tenant scope" } },
        { value: "system", label: { en: "System scope" } },
      ],
    },
    {
      path: "delivery",
      label: { en: "Delivery", de: "Auslieferung" },
      input: "select",
      options: [
        { value: "shared", label: { en: "Shared" } },
        { value: "per-instance", label: { en: "Per instance" } },
      ],
    },
  ],
};

const defineEventSchema: PatternFormSchema = {
  kind: "defineEvent",
  label: { en: "Define event", de: "Event definieren" },
  summary: { en: "Register an event payload shape with version." },
  category: "data",
  editability: "mixed",
  fields: [
    {
      path: "eventName",
      label: { en: "Name", de: "Name" },
      input: "text",
      required: true,
      placeholder: "taskCompleted",
    },
    {
      path: "schemaSource",
      label: { en: "Zod schema (source)", de: "Zod-Schema (Source)" },
      input: "code-block",
      language: "zod",
      readOnly: true,
    },
    {
      path: "version",
      label: { en: "Version", de: "Version" },
      input: "number",
      min: 1,
    },
  ],
};

const eventMigrationSchema: PatternFormSchema = {
  kind: "eventMigration",
  label: { en: "Event migration", de: "Event-Migration" },
  summary: { en: "Step-wise transform between event versions." },
  category: "data",
  editability: "mixed",
  fields: [
    {
      path: "eventName",
      label: { en: "Event", de: "Event" },
      input: "text",
      required: true,
    },
    {
      path: "fromVersion",
      label: { en: "From version", de: "Von Version" },
      input: "number",
      min: 1,
      required: true,
    },
    {
      path: "toVersion",
      label: { en: "To version", de: "Auf Version" },
      input: "number",
      min: 2,
      required: true,
    },
    {
      path: "transformBody",
      label: { en: "Transform (source)", de: "Transform (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
  ],
};

// --- Opaque patterns (entire pattern is read-only code) -------------------

const extendsRegistrarSchema: PatternFormSchema = {
  kind: "extendsRegistrar",
  label: { en: "Registrar extension", de: "Registrar-Erweiterung" },
  summary: { en: "Meta-programming surface — the Designer treats it as code." },
  category: "advanced",
  editability: "opaque",
  fields: [
    {
      path: "extensionName",
      label: { en: "Name", de: "Name" },
      input: "text",
      required: true,
      readOnly: true,
    },
    {
      path: "defBody",
      label: { en: "Definition body (source)", de: "Definitions-Body (Source)" },
      input: "code-block",
      language: "typescript",
      readOnly: true,
    },
  ],
};

const usesApiSchema: PatternFormSchema = {
  kind: "usesApi",
  label: { en: "Uses API", de: "Nutzt API" },
  summary: {
    en: "Cross-feature handler-ID dependency. Boot fails if no other feature exposes it.",
  },
  category: "advanced",
  editability: "static",
  fields: [
    {
      path: "apiName",
      label: { en: "API name", de: "API-Name" },
      input: "text",
      required: true,
    },
  ],
};

const exposesApiSchema: PatternFormSchema = {
  kind: "exposesApi",
  label: { en: "Exposes API", de: "Stellt API bereit" },
  summary: { en: "Declares this feature provides a handler matching the cross-feature contract." },
  category: "advanced",
  editability: "static",
  fields: [
    {
      path: "apiName",
      label: { en: "API name", de: "API-Name" },
      input: "text",
      required: true,
    },
  ],
};

const unknownSchema: PatternFormSchema = {
  kind: "unknown",
  label: { en: "Unknown call", de: "Unbekannter Call" },
  summary: { en: "Parser doesn't recognise this r.* method — read-only." },
  category: "advanced",
  editability: "opaque",
  fields: [
    {
      path: "methodName",
      label: { en: "Method", de: "Methode" },
      input: "text",
      readOnly: true,
    },
    {
      path: "source",
      label: { en: "Source", de: "Source" },
      input: "json-readonly",
      readOnly: true,
    },
  ],
};

// =============================================================================
// Catalogue — exhaustive map keyed by FeaturePatternKind
// =============================================================================

export const PATTERN_LIBRARY: Readonly<Record<FeaturePatternKind, PatternFormSchema>> = {
  requires: requiresSchema,
  optionalRequires: optionalRequiresSchema,
  readsConfig: readsConfigSchema,
  systemScope: systemScopeSchema,
  toggleable: toggleableSchema,
  entity: entitySchema,
  relation: relationSchema,
  nav: navSchema,
  workspace: workspaceSchema,
  config: configSchema,
  translations: translationsSchema,
  metric: metricSchema,
  secret: secretSchema,
  claimKey: claimKeySchema,
  referenceData: referenceDataSchema,
  useExtension: useExtensionSchema,
  screen: screenSchema,
  writeHandler: writeHandlerSchema,
  queryHandler: queryHandlerSchema,
  hook: hookSchema,
  entityHook: entityHookSchema,
  job: jobSchema,
  notification: notificationSchema,
  authClaims: authClaimsSchema,
  httpRoute: httpRouteSchema,
  projection: projectionSchema,
  multiStreamProjection: multiStreamProjectionSchema,
  defineEvent: defineEventSchema,
  eventMigration: eventMigrationSchema,
  extendsRegistrar: extendsRegistrarSchema,
  usesApi: usesApiSchema,
  exposesApi: exposesApiSchema,
  unknown: unknownSchema,
} satisfies Readonly<Record<FeaturePatternKind, PatternFormSchema>>;

/**
 * Lookup helper — convenience over `PATTERN_LIBRARY[kind]`. Throws when
 * the kind is missing from the catalogue, which is a programming error
 * the exhaustiveness test should catch at CI time.
 */
export function getPatternSchema(kind: FeaturePatternKind): PatternFormSchema {
  const schema = PATTERN_LIBRARY[kind];
  if (!schema) {
    throw new Error(`pattern-library: no schema for kind "${kind}"`);
  }
  return schema;
}

/**
 * Group the library by category — helper for the Designer's "add new
 * pattern" panel.
 */
export function groupByCategory(): Readonly<Record<PatternCategory, readonly PatternFormSchema[]>> {
  const groups: Record<PatternCategory, PatternFormSchema[]> = {
    data: [],
    behaviour: [],
    ui: [],
    meta: [],
    background: [],
    "cross-cutting": [],
    advanced: [],
  };
  for (const schema of Object.values(PATTERN_LIBRARY)) {
    groups[schema.category].push(schema);
  }
  for (const list of Object.values(groups)) {
    list.sort((a, b) => a.label.en.localeCompare(b.label.en));
  }
  return groups;
}
