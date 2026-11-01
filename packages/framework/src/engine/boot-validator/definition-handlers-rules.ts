import type { BootRuleTable } from "./boot-rule.ts";

export const DEFINITION_HANDLER_RULES = {
  escapeHatchAccessNotSystemAdmin: {
    id: "handler/escape-hatch-not-system-admin",
    summary: "A handler with escapeHatch is restricted to SystemAdmin.",
    fix: "Set access to { roles: [SystemAdmin] }.",
  },
  nameWithoutColon: {
    id: "handler/name-pattern-invalid",
    summary: 'Entity handler names use the "<entity>:<verb>" pattern.',
    fix: 'Name the handler like "note:create".',
  },
  nameMissingEntity: {
    id: "handler/name-missing-entity",
    summary: "Entity handler names start with the entity name.",
    fix: "Put the entity name before the colon.",
  },
  verbUnknown: {
    id: "handler/verb-unknown",
    summary: "Entity handler names end in a standard verb.",
    fix: "Use a standard verb or the explicit r.writeHandler / r.queryHandler form.",
  },
  agentRiskNotHigh: {
    id: "handler/agent-risk-not-high",
    summary: "Handlers with irreversible or instruction-carrying effects declare agent.risk high.",
    fix: 'Set agent.risk to "high".',
  },
  excludeFieldsVerbUnsupported: {
    id: "handler/exclude-fields-verb-unsupported",
    summary: "excludeFields is used on create and update handlers only.",
    fix: "Remove excludeFields from this handler.",
  },
  excludeFieldsUnknownField: {
    id: "handler/exclude-fields-unknown-field",
    summary: "excludeFields names fields of the entity.",
    fix: "Name an existing field or remove the entry.",
  },
  excludeFieldsTotalsPair: {
    id: "handler/exclude-fields-totals-pair",
    summary: "excludeFields leaves totalsMatch pairs together.",
    fix: "Keep both fields of the pair writable.",
  },
  excludeFieldsRequiredWithoutDefault: {
    id: "handler/exclude-fields-required-without-default",
    summary: "excludeFields on create does not exclude required fields without a default.",
    fix: "Give the field a default or keep it writable.",
  },
  restoreWithoutSoftDelete: {
    id: "handler/restore-without-soft-delete",
    summary: "Restore handlers exist only for entities with softDelete.",
    fix: "Declare softDelete: true on the entity or drop the restore verb.",
  },
  crudAccessUnresolved: {
    id: "handler/crud-access-unresolved",
    summary: "r.crud() resolves an access rule for every verb it registers.",
    fix: "Set write.access, read.access or verbAccess.<verb> in the r.crud options.",
  },
  nameDuplicate: {
    id: "handler/name-duplicate",
    summary: "A handler name is registered once per feature.",
    fix: "Use a distinct name or drop the verb from r.crud.",
  },
  accessRuleRequired: {
    id: "handler/access-rule-required",
    summary: "Explicit handlers declare an access rule.",
    fix: "Add access: { roles: [...] } or { openToAll: { reason } }.",
  },
  inlineFormIncomplete: {
    id: "handler/inline-form-incomplete",
    summary: "The inline handler form provides schema, handler and options.access.",
    fix: "Pass schema, handler and options with access.",
  },
  handlerAndPerformBoth: {
    id: "handler/handler-and-perform-both",
    summary: "A write handler sets handler or perform, not both.",
    fix: "Keep either the free-form handler or the perform pipeline.",
  },
} as const satisfies BootRuleTable;
