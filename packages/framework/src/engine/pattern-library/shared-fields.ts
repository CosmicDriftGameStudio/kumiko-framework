import type { FormFieldSpec } from "./types";

// =============================================================================
// Reusable field building blocks
// =============================================================================

export const HOOK_TYPE_OPTIONS = [
  { value: "validation", label: { en: "Validation", de: "Validierung" } },
  { value: "preSave", label: { en: "Pre-Save", de: "Vor Speichern" } },
  { value: "postSave", label: { en: "Post-Save", de: "Nach Speichern" } },
  { value: "preDelete", label: { en: "Pre-Delete", de: "Vor Löschen" } },
  { value: "postDelete", label: { en: "Post-Delete", de: "Nach Löschen" } },
  { value: "preQuery", label: { en: "Pre-Query", de: "Vor Abfrage" } },
  { value: "postQuery", label: { en: "Post-Query", de: "Nach Abfrage" } },
] as const;

export const HTTP_METHOD_OPTIONS = [
  { value: "GET", label: { en: "GET" } },
  { value: "POST", label: { en: "POST" } },
  { value: "PUT", label: { en: "PUT" } },
  { value: "PATCH", label: { en: "PATCH" } },
  { value: "DELETE", label: { en: "DELETE" } },
  { value: "HEAD", label: { en: "HEAD" } },
  { value: "OPTIONS", label: { en: "OPTIONS" } },
] as const;

export const CLAIM_KEY_TYPE_OPTIONS = [
  { value: "string", label: { en: "string" } },
  { value: "number", label: { en: "number" } },
  { value: "boolean", label: { en: "boolean" } },
  { value: "string[]", label: { en: "string[]" } },
  { value: "object", label: { en: "object" } },
] as const;

export const ID_TYPE_OPTIONS = [
  { value: "uuid", label: { en: "UUID (default)", de: "UUID (Standard)" } },
  { value: "serial", label: { en: "Serial integer", de: "Serial Integer" } },
] as const;

export const accessRuleField: FormFieldSpec = {
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
