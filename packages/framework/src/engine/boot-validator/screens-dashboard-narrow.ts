import { normalizeListColumn } from "../screen-helpers.ts";
import type {
  DashboardListPanel,
  DashboardPanelDefinition,
  DashboardStatGroupPanel,
  DashboardStatPanel,
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
  if (narrow.field !== undefined) {
    const columnFields = panel.columns.map((column) => normalizeListColumn(column).field);
    if (narrow.layout !== "line" || !columnFields.includes(narrow.field)) {
      throw bootRuleError(DASHBOARD_RULES.listNarrowFieldUnknown, {
        message: `${context} sets narrow.field "${narrow.field}", which needs narrow.layout "line" and a column of the panel (${columnFields.join(", ")}).`,
      });
    }
  }
  if (narrow.layout === "line" && panel.footerLink === undefined) {
    throw bootRuleError(DASHBOARD_RULES.listNarrowLineWithoutFooterLink, {
      message: `${context} sets narrow.layout "line" without footerLink — the line links to it. Add footerLink or use "cards".`,
    });
  }
}

const ROW_LINK_ICONS: readonly unknown[] = ["arrow", "chevron"];

/** The screen itself is checked by validateDashboardPanelLink; this covers the rest of the shape. */
export function validateListRowLinkShape(context: string, panel: DashboardListPanel): void {
  const { rowLink } = panel;
  // skip: the rows are not links
  if (rowLink === undefined) return;
  if (rowLink.paramField !== undefined && rowLink.paramField.trim().length === 0) {
    throw bootRuleError(DASHBOARD_RULES.listRowLinkInvalid, {
      message: `${context} rowLink.paramField is empty. Name the row field holding the params object or remove it.`,
    });
  }
  if (rowLink.icon !== undefined && !ROW_LINK_ICONS.includes(rowLink.icon)) {
    throw bootRuleError(DASHBOARD_RULES.listRowLinkInvalid, {
      message: `${context} rowLink.icon "${String(rowLink.icon)}" is not "arrow" or "chevron".`,
    });
  }
}

// "strip" is the default only without a label; a labelled group defaults to "cards".
function isTitledStrip(panel: DashboardStatGroupPanel): boolean {
  return panel.label !== undefined && panel.layout === "strip";
}

function validateStatGroupChildren(context: string, panel: DashboardStatGroupPanel): void {
  for (const stat of panel.stats) {
    if (stat.narrowLabel !== undefined && !isTitledStrip(panel)) {
      throw bootRuleError(DASHBOARD_RULES.statNarrowLabelOutsideGroup, {
        message: `${context} child "${stat.id}" sets narrowLabel, but only the one-line phone strip of a titled group with layout "strip" draws it. Give the group a label and layout "strip", or remove narrowLabel.`,
      });
    }
    if (stat.hideOnNarrow !== undefined) {
      throw bootRuleError(DASHBOARD_RULES.statGroupChildHideOnNarrow, {
        message: `${context} child "${stat.id}" sets hideOnNarrow — set it on the whole group instead; a hidden cell would leave a gap.`,
      });
    }
    if (stat.narrowOrder !== undefined) {
      throw bootRuleError(DASHBOARD_RULES.narrowOrderInvalid, {
        message: `${context} child "${stat.id}" sets narrowOrder — set it on the whole group instead.`,
      });
    }
    if (stat.narrowLabel !== undefined && stat.narrowLabel.trim().length === 0) {
      throw bootRuleError(DASHBOARD_RULES.statNarrowLabelOutsideGroup, {
        message: `${context} child "${stat.id}" sets an empty narrowLabel. Name an i18n key or remove it.`,
      });
    }
  }
}

function validateStatGroupNarrow(context: string, panel: DashboardStatGroupPanel): void {
  validateStatGroupChildren(context, panel);
  if (panel.icon !== undefined && !isTitledStrip(panel)) {
    throw bootRuleError(DASHBOARD_RULES.statGroupIconWithoutTitledStrip, {
      message: `${context} sets icon without a label or with layout "cards" — only the titled strip draws it. Add a label and layout "strip", or remove icon.`,
    });
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

function validateStatNarrowLabel(context: string, panel: DashboardStatPanel): void {
  if (panel.narrowLabel !== undefined) {
    throw bootRuleError(DASHBOARD_RULES.statNarrowLabelOutsideGroup, {
      message: `${context} sets narrowLabel outside a stat-group — only the one-line phone strip of a titled stat-group draws it. Move the stat into a group or remove narrowLabel.`,
    });
  }
}

function validateNarrowOrder(context: string, panel: DashboardPanelDefinition): void {
  const { narrowOrder } = panel;
  // skip: declared order
  if (narrowOrder === undefined) return;
  if (!Number.isInteger(narrowOrder) || narrowOrder < 0) {
    throw bootRuleError(DASHBOARD_RULES.narrowOrderInvalid, {
      message: `${context} narrowOrder "${String(narrowOrder)}" is not an integer of at least 0.`,
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
  validateNarrowOrder(`${prefix} panel "${panel.id}"`, panel);
  if (panel.kind === "stat") validateStatNarrowLabel(`${prefix} stat "${panel.id}"`, panel);
  if (panel.kind === "list") validateListNarrow(`${prefix} list-panel "${panel.id}"`, panel);
  else if (panel.kind === "stat-group") {
    validateStatGroupNarrow(`${prefix} stat-group "${panel.id}"`, panel);
  } else if (panel.kind === "text") validateTextNarrow(`${prefix} text-panel "${panel.id}"`, panel);
}
