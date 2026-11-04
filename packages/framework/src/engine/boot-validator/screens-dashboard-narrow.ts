import type {
  DashboardListPanel,
  DashboardPanelDefinition,
  DashboardStatGroupPanel,
  DashboardTextPanel,
} from "../types/screen.ts";
import { bootRuleError } from "./boot-rule.ts";
import { DASHBOARD_RULES } from "./screens-dashboard-rules.ts";

const STAT_GROUP_COLUMN_COUNTS: readonly unknown[] = [2, 3, 4];
const LIST_NARROW_LAYOUTS: readonly unknown[] = ["cards", "line"];

function validateListNarrow(context: string, panel: DashboardListPanel): void {
  const { narrow } = panel;
  // skip: the list keeps its table on a phone
  if (narrow === undefined) return;
  if (narrow.limit !== undefined && (!Number.isInteger(narrow.limit) || narrow.limit < 1)) {
    throw bootRuleError(DASHBOARD_RULES.listNarrowInvalid, {
      message: `${context} narrow.limit "${String(narrow.limit)}" is not a positive integer. Set it to a whole number of at least 1.`,
    });
  }
  if (narrow.layout !== undefined && !LIST_NARROW_LAYOUTS.includes(narrow.layout)) {
    throw bootRuleError(DASHBOARD_RULES.listNarrowInvalid, {
      message: `${context} narrow.layout "${String(narrow.layout)}" is not "cards" or "line".`,
    });
  }
  if (narrow.layout === "line" && panel.footerLink === undefined) {
    throw bootRuleError(DASHBOARD_RULES.listNarrowLineWithoutFooterLink, {
      message: `${context} sets narrow.layout "line" without footerLink — the line links to it. Add footerLink or use "cards".`,
    });
  }
}

function validateStatGroupNarrow(context: string, panel: DashboardStatGroupPanel): void {
  for (const stat of panel.stats) {
    if (stat.hideOnNarrow !== undefined) {
      throw bootRuleError(DASHBOARD_RULES.statGroupChildHideOnNarrow, {
        message: `${context} child "${stat.id}" sets hideOnNarrow — set it on the whole group instead; a hidden cell would leave a gap.`,
      });
    }
  }
  // skip: no column count declared
  if (panel.columns === undefined) return;
  if (!STAT_GROUP_COLUMN_COUNTS.includes(panel.columns)) {
    throw bootRuleError(DASHBOARD_RULES.statGroupColumnsInvalid, {
      message: `${context} columns "${String(panel.columns)}" is not 2, 3 or 4.`,
    });
  }
  const layout = panel.layout ?? (panel.label === undefined ? "strip" : "cards");
  if (layout !== "cards") {
    throw bootRuleError(DASHBOARD_RULES.statGroupColumnsInvalid, {
      message: `${context} sets columns on a "strip" group — columns only lays out layout "cards". Give the group a label or layout: "cards", or remove columns.`,
    });
  }
}

function validateTextNarrow(context: string, panel: DashboardTextPanel): void {
  // skip: no narrow variant
  if (panel.narrowBlocks === undefined) return;
  if (panel.narrowBlocks.length === 0 || (panel.blocks ?? []).length === 0) {
    throw bootRuleError(DASHBOARD_RULES.textNarrowBlocksWithoutBlocks, {
      message: `${context} sets narrowBlocks without blocks, or an empty narrowBlocks. Declare blocks (shown from sm up) and at least one narrow block, or remove narrowBlocks.`,
    });
  }
}

// Phone-layout options per panel kind; `hideOnNarrow` itself is a plain flag with no cross-field rule.
export function validateDashboardPanelNarrow(
  featureName: string,
  screenId: string,
  panel: DashboardPanelDefinition,
): void {
  const prefix = `[Feature ${featureName}] Screen "${screenId}" (dashboard)`;
  if (panel.kind === "list") validateListNarrow(`${prefix} list-panel "${panel.id}"`, panel);
  else if (panel.kind === "stat-group") {
    validateStatGroupNarrow(`${prefix} stat-group "${panel.id}"`, panel);
  } else if (panel.kind === "text") validateTextNarrow(`${prefix} text-panel "${panel.id}"`, panel);
}
