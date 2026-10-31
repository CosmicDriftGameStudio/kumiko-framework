import type { BootRuleTable } from "./boot-rule.ts";

export const CONFIG_EDIT_ACTION_RULES = {
  duplicateId: {
    id: "config-edit-action/duplicate-id",
    summary: "A configEdit screen declares each action id once.",
    fix: "Rename or remove the repeated action id.",
  },
  unknownHandler: {
    id: "config-edit-action/unknown-handler",
    summary: "A configEdit action points at a registered write handler.",
    fix: 'Use the qualified write handler name "<feature>:write:<handler>" of a registered handler.',
  },
  unknownAfterField: {
    id: "config-edit-action/unknown-after-field",
    summary: "A configEdit action sits after a field that is part of the layout.",
    fix: "Set afterField to a field name that appears in one of the layout sections.",
  },
} as const satisfies BootRuleTable;
