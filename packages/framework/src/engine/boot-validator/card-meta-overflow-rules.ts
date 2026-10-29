import type { BootRuleTable } from "./boot-rule.ts";

export const CARD_META_OVERFLOW_RULES = {
  overflow: {
    id: "list/card-meta-overflow",
    summary: "A card list shows at most the maximum number of meta columns.",
    fix: "Reduce each list to the maximum number of meta columns or mark the others hideOnNarrow: true.",
  },
} as const satisfies BootRuleTable;
