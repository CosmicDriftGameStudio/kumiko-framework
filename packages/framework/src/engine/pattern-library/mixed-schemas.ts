// Mixed pattern schemas (header form + opaque body source).

import { accessRuleField, HOOK_TYPE_OPTIONS, HTTP_METHOD_OPTIONS } from "./shared-fields";
import type { PatternFormSchema } from "./types";

// --- Mixed patterns (header form + opaque body source) --------------------

export const screenSchema: PatternFormSchema = {
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

export const writeHandlerSchema: PatternFormSchema = {
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
      path: "unsafeSkipTransitionGuard",
      label: { en: "Skip transition guard", de: "Übergangs-Guard überspringen" },
      input: "boolean",
    },
  ],
};

export const queryHandlerSchema: PatternFormSchema = {
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

export const streamHandlerSchema: PatternFormSchema = {
  kind: "streamHandler",
  label: { en: "Stream handler", de: "Stream-Handler" },
  summary: { en: "Streaming read endpoint (SSE) with Zod schema + async-generator body." },
  category: "behaviour",
  editability: "mixed",
  fields: [
    {
      path: "handlerName",
      label: { en: "Name", de: "Name" },
      input: "text",
      required: true,
      placeholder: "chat:complete",
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

export const hookSchema: PatternFormSchema = {
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

export const jobSchema: PatternFormSchema = {
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

export const notificationSchema: PatternFormSchema = {
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

export const authClaimsSchema: PatternFormSchema = {
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

export const httpRouteSchema: PatternFormSchema = {
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

export const projectionSchema: PatternFormSchema = {
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

export const multiStreamProjectionSchema: PatternFormSchema = {
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

export const defineEventSchema: PatternFormSchema = {
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
    {
      path: "migrations",
      label: {
        en: "Migrations (fromVersion → transform)",
        de: "Migrationen (fromVersion → Transform)",
      },
      input: "key-value-map",
      keyPlaceholder: "1",
      valueInput: "code-block",
    },
  ],
};
