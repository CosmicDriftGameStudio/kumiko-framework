import type { BootRuleTable } from "./boot-rule.ts";

export const DEFINITION_ROLE_ASSIGNMENT_RULES = {
  nameEmpty: {
    id: "role/assignable-name-empty",
    summary: "Assignable role names are non-empty.",
    fix: "Give the role a name.",
  },
  builtIn: {
    id: "role/assignable-built-in",
    summary: "Assignable roles are not built-in roles.",
    fix: "Pick a different role name.",
  },
  reservedMembership: {
    id: "role/assignable-reserved",
    summary: "Assignable roles are not reserved platform roles.",
    fix: "Pick a different role name.",
  },
  assignableFromInvalid: {
    id: "role/assignable-from-invalid",
    summary: "assignableFrom is one of the allowed roles.",
    fix: "Use a role from the list in the message.",
  },
  assignableFromConflict: {
    id: "role/assignable-from-conflict",
    summary: "A role is declared with one assignableFrom value.",
    fix: "Declare the same assignableFrom everywhere or declare it once.",
  },
} as const satisfies BootRuleTable;
