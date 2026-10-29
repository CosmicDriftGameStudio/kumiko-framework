import type { BootRuleTable } from "./boot-rule.ts";

export const API_EXT_RULES = {
  unknownApi: {
    id: "api/unknown-api",
    summary: "Every r.usesApi name is exposed by some mounted feature.",
    fix: "Mount the feature that exposes the API or fix the API name.",
  },
  providerNotRequired: {
    id: "api/provider-not-required",
    summary: "A feature using an API lists the exposing feature in requires or optionalRequires.",
    fix: "Add the exposing feature via r.requires({ features: [...] }).",
  },
  providerNotMounted: {
    id: "api/provider-not-mounted",
    summary: "The feature exposing a used API is part of the app's feature list.",
    fix: "Register the provider feature in the app's feature list.",
  },
  unknownExtension: {
    id: "extension/unknown-extension",
    summary: "Every extension a feature uses is defined by some mounted feature.",
    fix: "Register the feature that defines the extension or fix the extension name.",
  },
  extensionProviderNotRequired: {
    id: "extension/provider-not-required",
    summary:
      "A feature using an extension lists the defining feature in requires or optionalRequires.",
    fix: "Add the defining feature via r.requires({ features: [...] }).",
  },
} as const satisfies BootRuleTable;
