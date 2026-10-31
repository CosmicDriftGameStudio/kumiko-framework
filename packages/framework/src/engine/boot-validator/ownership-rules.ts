import type { BootRuleTable } from "./boot-rule.ts";

export const OWNERSHIP_RULES = {
  unknownRole: {
    id: "ownership/unknown-role",
    summary: "An access map names only roles that some feature defines.",
    fix: "Use a defined role name or declare the role.",
  },
  whereOnWritePath: {
    id: "ownership/where-on-write-path",
    summary:
      "A write access map uses from(...) rules, not where(...), because where is read-only SQL.",
    fix: "Replace the where rule with a from rule on the write path.",
  },
  whereOnFieldRead: {
    id: "ownership/where-on-field-read",
    summary: "A field-level read access map uses from(...) rules, not where(...).",
    fix: "Replace the where rule with a from rule on the field read path.",
  },
  unknownClaim: {
    id: "ownership/unknown-claim",
    summary: "A from(...) ownership rule references only claims declared via r.claimKey.",
    fix: 'Declare it via r.claimKey("...", { type: "..." }) in the owning feature.',
  },
  unknownColumn: {
    id: "ownership/unknown-column",
    summary: "A from(...) ownership rule references only columns that exist on the entity.",
    fix: "Use one of the entity's columns.",
  },
} as const satisfies BootRuleTable;
