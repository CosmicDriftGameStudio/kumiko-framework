import type { BootRuleTable } from "./boot-rule.ts";

export const DEFINITION_OWNERSHIP_FROM_RULES = {
  refWithoutColon: {
    id: "ownership/from-ref-without-colon",
    summary: 'from() refs have the form "user:<field>" or "claim:<feature>:<key>".',
    fix: "Add the prefix and colon to the ref.",
  },
  userColumnMissing: {
    id: "ownership/from-user-column-missing",
    summary: "from() with a user ref names the column explicitly.",
    fix: 'Pass a column, e.g. from("user:id", "assigneeId").',
  },
  userRefUnsupported: {
    id: "ownership/from-user-ref-unsupported",
    summary: 'from() user refs are "user:id" or "user:tenantId".',
    fix: "Use one of the two supported user refs.",
  },
  claimRefInvalid: {
    id: "ownership/from-claim-ref-invalid",
    summary: 'from() claim refs are "claim:<feature>:<shortName>".',
    fix: "Add the feature and short name to the ref.",
  },
  prefixUnsupported: {
    id: "ownership/from-prefix-unsupported",
    summary: 'from() refs start with "user" or "claim".',
    fix: "Use a supported prefix.",
  },
} as const satisfies BootRuleTable;
