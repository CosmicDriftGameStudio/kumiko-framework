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
  parentOnFieldAccess: {
    id: "ownership/parent-on-field-access",
    summary:
      "A fromParent(...) rule appears only in an entity-level access map, not in field access.",
    fix: "Move the rule to the entity access map or use a from rule on the field.",
  },
  parentFieldNotReference: {
    id: "ownership/parent-field-not-reference",
    summary: "A fromParent(field, entity) rule names a reference field that points at that entity.",
    fix: "Name a reference field of this entity whose target is the given parent entity.",
  },
  parentUnknownEntity: {
    id: "ownership/parent-unknown-entity",
    summary: "A fromParent(field, entity) rule names an entity that some feature registers.",
    fix: "Name a registered parent entity.",
  },
  parentGlobalEntity: {
    id: "ownership/parent-global-entity",
    summary: "A fromParent rule joins tenant-bound entities, never one with tenancy global.",
    fix: "Use fromParent only between tenant-bound child and parent entities.",
  },
  parentCycle: {
    id: "ownership/parent-cycle",
    summary: "Following fromParent rules of one role never returns to an entity already visited.",
    fix: "Break the cycle: give one entity in the chain a from rule or all.",
  },
} as const satisfies BootRuleTable;
