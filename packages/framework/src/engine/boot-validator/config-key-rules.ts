import type { BootRuleTable } from "./boot-rule.ts";

export const CONFIG_KEY_RULES = {
  boundsNonNumber: {
    id: "config-key/bounds-non-number",
    summary: "A config key declares bounds only when its type is number.",
    fix: 'Remove bounds or change the key type to "number".',
  },
  boundsMinAboveMax: {
    id: "config-key/bounds-min-above-max",
    summary: "A config key's bounds.min is at or below its bounds.max.",
    fix: "Set bounds.min to a value at or below bounds.max.",
  },
  defaultBelowMin: {
    id: "config-key/default-below-min",
    summary: "A config key's default is not below its bounds.min.",
    fix: "Raise the default or lower bounds.min.",
  },
  defaultAboveMax: {
    id: "config-key/default-above-max",
    summary: "A config key's default is not above its bounds.max.",
    fix: "Lower the default or raise bounds.max.",
  },
  computedAndEncrypted: {
    id: "config-key/computed-and-encrypted",
    summary:
      'A config key is either encrypted (encrypted or backing="secrets") or computed, never both.',
    fix: 'Use either encrypted/backing="secrets" or a computed resolver on the key.',
  },
  requiredWithComputed: {
    id: "config-key/required-with-computed",
    summary: "A computed config key is not marked required, because it can never be missing.",
    fix: "Drop required or the computed resolver.",
  },
  requiredWithDefault: {
    id: "config-key/required-with-default",
    summary:
      "A required config key has no non-empty default, otherwise it can never be unset and readiness never flags it.",
    fix: 'Use default "" or drop required.',
  },
  perRequestText: {
    id: "config-key/per-request-text",
    summary: 'A config key of type "text" does not set allowPerRequest (XSS/injection risk).',
    fix: "Remove allowPerRequest or change the key type.",
  },
  perRequestEncrypted: {
    id: "config-key/per-request-encrypted",
    summary: 'A config key with encrypted/backing="secrets" does not set allowPerRequest.',
    fix: "Remove allowPerRequest or the secrets storage from the key.",
  },
  conditionalOptions: {
    id: "config-key/conditional-options",
    summary:
      "A config key does not declare conditionalOptions, which only entity select fields support.",
    fix: "Remove conditionalOptions from the config key.",
  },
  optionsQueryPayloadWithoutQuery: {
    id: "config-key/options-query-payload-without-query",
    summary: "A config key that declares optionsQueryPayload also declares optionsQuery.",
    fix: "Set optionsQuery or remove optionsQueryPayload.",
  },
  optionsQueryEmpty: {
    id: "config-key/options-query-empty",
    summary: "A config key's optionsQuery is a non-empty query name when present.",
    fix: "Set it to a query name or remove it.",
  },
  optionsQueryNotSelect: {
    id: "config-key/options-query-not-select",
    summary: 'A config key declares optionsQuery only when its type is "select".',
    fix: 'Change the key type to "select" or remove optionsQuery.',
  },
  optionsAndOptionsQuery: {
    id: "config-key/options-and-options-query",
    summary: "A config key declares either static options or optionsQuery, not both.",
    fix: "Remove options or optionsQuery.",
  },
  optionsQueryPerRequest: {
    id: "config-key/options-query-per-request",
    summary:
      "A config key with optionsQuery does not set allowPerRequest, which would bypass the option set unchecked.",
    fix: "Remove allowPerRequest or optionsQuery.",
  },
  optionsQueryPayloadSelfReference: {
    id: "config-key/options-query-payload-self-reference",
    summary: "A config key's optionsQueryPayload does not reference the key itself.",
    fix: "Reference a different config key.",
  },
  optionsQueryPayloadUnknownKey: {
    id: "config-key/options-query-payload-unknown-key",
    summary: "A config key's optionsQueryPayload references only config keys of the same feature.",
    fix: "Reference an existing config key of the feature or remove the entry.",
  },
  secretsScopeNotSystem: {
    id: "config-key/secrets-scope-not-system",
    summary:
      'A config key with backing="secrets" has scope "system", because secrets storage does not cascade.',
    fix: 'Set scope to "system" or drop backing="secrets".',
  },
  piiEncryptedNotText: {
    id: "config-key/pii-encrypted-not-text",
    summary: 'A config key with piiEncrypted has type "text".',
    fix: 'Use type="text" or remove piiEncrypted.',
  },
  piiEncryptedSystemScope: {
    id: "config-key/pii-encrypted-system-scope",
    summary:
      "A config key with piiEncrypted is not system-scoped, because system scope has no subject to encrypt under.",
    fix: 'Use scope="tenant" or "user", or remove piiEncrypted.',
  },
  piiEncryptedAndEncrypted: {
    id: "config-key/pii-encrypted-and-encrypted",
    summary: 'A config key uses piiEncrypted or encrypted/backing="secrets", never both.',
    fix: "Pick one of piiEncrypted (subject-KMS) or encrypted (shared cipher).",
  },
  unknownConfigRead: {
    id: "config-key/unknown-config-read",
    summary: "A feature reads only config keys that some feature defines.",
    fix: "Declare the key via r.config(...) in a feature, or fix the key name.",
  },
  circularDependency: {
    id: "feature/circular-dependency",
    summary: "Feature requires() links form no cycle.",
    fix: "Break the cycle by removing one requires() link.",
  },
} as const satisfies BootRuleTable;
