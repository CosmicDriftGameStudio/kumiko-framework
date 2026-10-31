import type { BootRuleTable } from "./boot-rule.ts";

export const NAV_RULES = {
  screenUnregistered: {
    id: "nav/screen-unregistered",
    summary: "A nav entry's screen is a registered screen qualified name.",
    fix: 'Use "<feature>:screen:<id>" pointing at an r.screen() declaration.',
  },
  parentUnregistered: {
    id: "nav/parent-unregistered",
    summary: "A nav entry's parent is a registered nav entry qualified name.",
    fix: 'Use "<feature>:nav:<id>" pointing at a registered nav entry.',
  },
  workspaceUnregistered: {
    id: "nav/workspace-unregistered",
    summary: "A nav entry self-assigns only to registered workspaces.",
    fix: 'Use "<feature>:workspace:<id>" pointing at an r.workspace() declaration.',
  },
  createActionTargetCount: {
    id: "nav/create-action-target-count",
    summary: 'A nav createAction sets exactly one of "screen" and "target".',
    fix: 'Set either "screen" or "target" on the action.',
  },
  createActionScreenUnregistered: {
    id: "nav/create-action-screen-unregistered",
    summary: "A nav createAction screen is a registered screen qualified name.",
    fix: 'Use "<feature>:screen:<id>" pointing at an r.screen() declaration.',
  },
  parentCycle: {
    id: "nav/parent-cycle",
    summary: "Nav entry parents form no cycle.",
    fix: "Change or remove the parent of one entry in the cycle.",
  },
  workspaceNavUnregistered: {
    id: "workspace/nav-unregistered",
    summary: "A workspace references only registered nav entries.",
    fix: 'Use "<feature>:nav:<id>" pointing at an r.nav() declaration.',
  },
  multipleDefaultWorkspaces: {
    id: "workspace/multiple-defaults",
    summary: "At most one workspace per app declares default: true.",
    fix: "Remove default: true from all but one workspace.",
  },
} as const satisfies BootRuleTable;
