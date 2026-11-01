import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const CAP_OVERVIEW_BOOT_RULES = {
  emptyCaps: {
    id: "cap-overview/empty-caps",
    summary: "createCapOverviewFeature receives at least one cap.",
    fix: "Pass a non-empty caps list.",
  },
  unknownListCap: {
    id: "cap-overview/unknown-list-cap",
    summary: "listCaps only references cap ids declared in caps.",
    fix: "Use ids from caps in listCaps.",
  },
} as const satisfies BootRuleTable;
