import type { BootRuleTable } from "./boot-rule.ts";

export const SCREEN_ACTION_RULES = {
  actionIcon: {
    id: "screen/action-icon",
    summary: "Every screen action resolves to a registered icon.",
    fix: "Set icon to a registered NAV_ICONS key or use an action id that resolves one via the default icon map.",
  },
} as const satisfies BootRuleTable;
