// @runtime client
// Pure name/string constants — browser-safe, importable from web client code
// (configClient() pins its feature name to CONFIG_FEATURE).
export const CONFIG_FEATURE = "config" as const;

// Qualified write handler names (QN format: scope:type:name)
export const ConfigHandlers = {
  set: "config:write:set",
  reset: "config:write:reset",
} as const;

// Qualified query handler names (QN format: scope:type:name)
export const ConfigQueries = {
  cascade: "config:query:cascade",
  values: "config:query:values",
  schema: "config:query:schema",
  readiness: "config:query:readiness",
} as const;

// Error codes
export const ConfigErrors = {
  unknownKey: "unknown_config_key",
  systemOnly: "config_key_is_system_only",
  invalidScope: "invalid_scope",
  typeError: "type_error",
  invalidOption: "invalid_option",
} as const;
