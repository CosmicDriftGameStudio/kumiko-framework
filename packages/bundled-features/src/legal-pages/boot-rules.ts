import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const LEGAL_PAGES_BOOT_RULES = {
  invalidRoute: {
    id: "legal-pages/invalid-route",
    summary: "Legal page routes declare path, slug and lang, and the path starts with a slash.",
    fix: "Fix the route named in the error message.",
  },
  duplicateRoutePath: {
    id: "legal-pages/duplicate-route-path",
    summary: "Legal page route paths are unique.",
    fix: "Remove or rename the duplicate route.",
  },
  routesWithoutRequiredBlocks: {
    id: "legal-pages/routes-without-required-blocks",
    summary: "Custom routes that miss the default required blocks pass requiredBlocks explicitly.",
    fix: "Pass requiredBlocks (or an empty array) alongside custom routes.",
  },
} as const satisfies BootRuleTable;
