import type { BootRuleTable } from "./boot-rule.ts";

export const CHILD_SEARCH_RULES = {
  childSearchUnknownEntity: {
    id: "child-search/unknown-entity",
    summary: "A searchable hasMany relation targets an entity that some feature registers.",
    fix: "Point the relation target at a registered entity or drop searchable.",
  },
  childSearchUnknownForeignKey: {
    id: "child-search/unknown-foreign-key",
    summary:
      "A searchable hasMany relation names a foreignKey that is a field of the target entity.",
    fix: "Use a field of the target entity as the foreignKey.",
  },
  childSearchNoSearchableField: {
    id: "child-search/no-searchable-field",
    summary: "A searchable hasMany relation targets an entity with at least one searchable field.",
    fix: "Mark a field of the target entity searchable or drop searchable from the relation.",
  },
} as const satisfies BootRuleTable;
