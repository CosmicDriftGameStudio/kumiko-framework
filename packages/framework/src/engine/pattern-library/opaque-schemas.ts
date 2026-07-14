import type { PatternFormSchema } from "./types";

// --- Opaque patterns (entire pattern is read-only code) -------------------

export const extendsRegistrarSchema: PatternFormSchema = {
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

export const usesApiSchema: PatternFormSchema = {
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

export const exposesApiSchema: PatternFormSchema = {
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

// Visual-Tree pattern schemas. treeActions is a static map (Designer
// renders the action-name → ActionDef pairs as a nested form), tree is
// closure-only (Designer shows the provider body as read-only code).
export const treeActionsSchema: PatternFormSchema = {
  kind: "treeActions",
  label: { en: "Tree actions", de: "Tree-Actions" },
  summary: { en: "Action verbs the Visual-Tree dispatches via buildTarget." },
  category: "ui",
  editability: "static",
  singleton: true,
  fields: [
    {
      path: "definitions",
      label: { en: "Action definitions", de: "Action-Definitionen" },
      input: "json-readonly",
      readOnly: true,
    },
  ],
};

export const envSchemaSchema: PatternFormSchema = {
  kind: "envSchema",
  label: { en: "Env schema", de: "Env-Schema" },
  summary: {
    en: "Zod-object declaring this feature's required env-vars. Apps merge it via composeEnvSchema for boot-validation.",
  },
  category: "advanced",
  editability: "opaque",
  fields: [
    {
      path: "schemaBody",
      label: { en: "Schema", de: "Schema" },
      input: "json-readonly",
      readOnly: true,
    },
  ],
};

export const unknownSchema: PatternFormSchema = {
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
