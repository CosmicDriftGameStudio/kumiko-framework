import type { BootRuleTable } from "./boot-rule.ts";

export const DASHBOARD_RULES = {
  emptyPanels: {
    id: "dashboard/empty-panels",
    summary: "A dashboard declares at least one panel.",
    fix: "Add a panel to panels.",
  },
  duplicatePanelId: {
    id: "dashboard/duplicate-panel-id",
    summary: "Panel ids (including stat-group children) are unique within a dashboard.",
    fix: "Give each panel a unique id.",
  },
  actionRowClick: {
    id: "dashboard/action-row-click",
    summary: "A dashboard action does not set rowClick.",
    fix: "Remove rowClick from the action.",
  },
  actionDrawer: {
    id: "dashboard/action-drawer",
    summary: "A dashboard action is not a drawer action.",
    fix: "Use a navigate, writeHandler or clientAction action.",
  },
  actionRedirect: {
    id: "dashboard/action-redirect",
    summary: "A dashboard writeHandler action does not set redirect.",
    fix: "Remove redirect from the action.",
  },
  actionsWithoutRecord: {
    id: "dashboard/actions-without-record",
    summary: "A dashboard with actions declares a record binding.",
    fix: "Add record: { param } or remove actions.",
  },
  recordParamEmpty: {
    id: "dashboard/record-param-empty",
    summary: "record.param is a non-empty string.",
    fix: "Name the URL search param carrying the record id.",
  },
  recordPayloadKeyEmpty: {
    id: "dashboard/record-payload-key-empty",
    summary: "record.payloadKey is non-empty when set.",
    fix: "Omit payloadKey to reuse record.param, or name a key.",
  },
  recordQueryEmpty: {
    id: "dashboard/record-query-empty",
    summary: "record.query is non-empty when set.",
    fix: "Set a registered query name or omit record.query.",
  },
  recordTitleFieldUnusable: {
    id: "dashboard/record-title-field-unusable",
    summary: "record.titleField needs record.query and a non-empty field name.",
    fix: "Add record.query and name a field, or remove titleField.",
  },
  recordParamCollision: {
    id: "dashboard/record-param-collision",
    summary: "record.param and payloadKey differ from the filter and timeRange ids.",
    fix: "Use a different name for the record param or the filter/timeRange id.",
  },
  refreshSecondsAndField: {
    id: "dashboard/refresh-seconds-and-field",
    summary: "A dashboard refresh sets either seconds or field, not both.",
    fix: "Keep exactly one of seconds and field.",
  },
  refreshSecondsTooShort: {
    id: "dashboard/refresh-seconds-too-short",
    summary: "refresh.seconds is a number of at least DASHBOARD_MIN_REFRESH_SECONDS.",
    fix: "Raise refresh.seconds to the minimum or more.",
  },
  refreshFieldEmpty: {
    id: "dashboard/refresh-field-empty",
    summary: "refresh.field is non-empty.",
    fix: "Name the record field holding the seconds.",
  },
  refreshFieldWithoutRecordQuery: {
    id: "dashboard/refresh-field-without-record-query",
    summary: "A field-driven refresh has a record.query to read the seconds from.",
    fix: "Add record: { param, query } or use refresh: { seconds }.",
  },
  timeRangeIdEmpty: {
    id: "dashboard/time-range-id-empty",
    summary: "The dashboard timeRange has a non-empty id.",
    fix: "Set a non-empty timeRange.id.",
  },
  timeRangeIdCollidesFilter: {
    id: "dashboard/time-range-id-collides-filter",
    summary: "The timeRange id differs from the filter id.",
    fix: "Use a timeRange.id different from the filter id.",
  },
  timeRangeOptionsEmpty: {
    id: "dashboard/time-range-options-empty",
    summary: "The timeRange declares at least one option.",
    fix: "Add an option to timeRange.options.",
  },
  timeRangeOptionIncomplete: {
    id: "dashboard/time-range-option-incomplete",
    summary: "Every timeRange option has a non-empty value and label.",
    fix: "Give every option a value and a label.",
  },
  timeRangeOptionDuplicate: {
    id: "dashboard/time-range-option-duplicate",
    summary: "timeRange option values are unique.",
    fix: "Use each option value once.",
  },
  timeRangeDefaultUnknown: {
    id: "dashboard/time-range-default-unknown",
    summary: "timeRange.default is one of the option values.",
    fix: "Set default to one of the options.",
  },
  embeddedScreenUnresolved: {
    id: "dashboard/embedded-screen-unresolved",
    summary: "A screen panel's screen and fallback resolve to registered screens.",
    fix: 'Use a same-feature short id or a cross-feature QN "<feature>:screen:<id>".',
  },
  embeddedScreenType: {
    id: "dashboard/embedded-screen-type",
    summary: "A screen panel embeds only an embeddable screen type.",
    fix: "Embed a projectionList, projectionDetail, actionForm, secretMint, configEdit or secretsEdit screen, or use a custom panel.",
  },
  embeddedDetailWithoutRecord: {
    id: "dashboard/embedded-detail-without-record",
    summary: "Embedding a projectionDetail needs a record binding on the host dashboard.",
    fix: "Add record: { param } to the dashboard or embed another screen type.",
  },
  embeddedFormNavigates: {
    id: "dashboard/embedded-form-navigates",
    summary: "An embedded actionForm or secretMint sets neither redirect nor a cancelTarget.",
    fix: "Embed a screen without redirect and with cancelTarget: false (or omitted).",
  },
  panelFallbackWithoutVisibleWhen: {
    id: "dashboard/panel-fallback-without-visible-when",
    summary: "A screen panel with a fallback also declares visibleWhen.",
    fix: "Add visibleWhen or remove fallback.",
  },
  panelFallbackGated: {
    id: "dashboard/panel-fallback-gated",
    summary: "A panel fallback screen has no visibleWhen of its own.",
    fix: "Embed a fallback screen without visibleWhen.",
  },
  textPanelEmpty: {
    id: "dashboard/text-panel-empty",
    summary: "A text panel declares at least one block or a query.",
    fix: "Add at least one block or set query.",
  },
  statNavigateParamsInvalid: {
    id: "dashboard/stat-navigate-params-invalid",
    summary: "A stat's navigate.params has non-empty keys and string values.",
    fix: "Use { key: 'value' } with non-empty keys and string values, or remove params.",
  },
  textListBlockEmpty: {
    id: "dashboard/text-list-block-empty",
    summary: "A text list block has items.",
    fix: "Add items or remove the block.",
  },
  statNavigateCustomWithFilter: {
    id: "dashboard/stat-navigate-custom-with-filter",
    summary: "A stat navigating to a custom screen does not set namedFilter.",
    fix: "Remove navigate.namedFilter; a custom screen has no namedFilters.",
  },
  panelLinkTarget: {
    id: "dashboard/panel-link-target",
    summary:
      "A list panel footerLink or stat-group link targets a registered screen, sets string-valued params, and uses namedFilter only on a list screen that declares it.",
    fix: "Point screen at a registered screen, give params string values, and drop namedFilter unless the target list declares it.",
  },
  listNarrowInvalid: {
    id: "dashboard/list-narrow-invalid",
    summary:
      'A list panel\'s narrow.limit is a positive integer and narrow.layout is "cards" or "line".',
    fix: 'Set narrow.limit to a whole number of at least 1 and narrow.layout to "cards" or "line".',
  },
  listNarrowLineWithoutFooterLink: {
    id: "dashboard/list-narrow-line-without-footer-link",
    summary: 'A list panel with narrow.layout "line" declares footerLink, the target of the line.',
    fix: 'Add footerLink or use narrow.layout "cards".',
  },
  listRowLinkInvalid: {
    id: "dashboard/list-row-link-invalid",
    summary:
      'A list panel rowLink names a registered screen, a non-empty paramField and an icon of "arrow" or "chevron".',
    fix: 'Set rowLink.screen to a registered screen, paramField to the row field holding the params object and icon to "arrow" or "chevron".',
  },
  statGroupColumnsInvalid: {
    id: "dashboard/stat-group-columns-invalid",
    summary: 'A stat-group\'s columns is 2, 3 or 4 and needs layout "cards".',
    fix: 'Set columns to 2, 3 or 4 and give the group a label or layout: "cards", or remove columns.',
  },
  statGroupChildHideOnNarrow: {
    id: "dashboard/stat-group-child-hide-on-narrow",
    summary: "Stat-group children do not set hideOnNarrow.",
    fix: "Set hideOnNarrow on the whole group instead.",
  },
  listNarrowFieldUnknown: {
    id: "dashboard/list-narrow-field-unknown",
    summary:
      "A list panel's narrow.field is set only with narrow.layout \"line\" and names one of the panel's columns.",
    fix: 'Set narrow.layout "line" and name a column field of the panel, or remove narrow.field.',
  },
  narrowOrderInvalid: {
    id: "dashboard/narrow-order-invalid",
    summary:
      "A panel's narrowOrder is an integer of at least 0 and is not set on a stat-group child.",
    fix: "Set narrowOrder to a whole number from 0 up on the panel (or the whole stat-group).",
  },
  statNarrowLabelOutsideGroup: {
    id: "dashboard/stat-narrow-label-outside-group",
    summary:
      "A stat's narrowLabel is non-empty and only set on a stat-group child (the one-line phone strip is the only place it is drawn).",
    fix: "Move the stat into a titled stat-group or remove narrowLabel.",
  },
  statGroupIconWithoutTitledStrip: {
    id: "dashboard/stat-group-icon-without-titled-strip",
    summary:
      'A stat-group\'s icon needs a label and layout "strip" (the icon stands in the one-line phone strip).',
    fix: 'Give the group a label and layout "strip", or remove icon.',
  },
  textNarrowBlocksWithoutBlocks: {
    id: "dashboard/text-narrow-blocks-without-blocks",
    summary: "A text panel with narrowBlocks also declares blocks, and narrowBlocks is non-empty.",
    fix: "Add blocks (the wide variant) or remove narrowBlocks.",
  },
  textLinkUnresolved: {
    id: "dashboard/text-link-unresolved",
    summary: "A text link block's screen resolves to a registered screen.",
    fix: 'Use a same-feature short id or a cross-feature QN "<feature>:screen:<id>".',
  },
  textLinkRolesEmpty: {
    id: "dashboard/text-link-roles-empty",
    summary: "A text link block's roles list is non-empty when set.",
    fix: "List the roles or omit roles.",
  },
  panelVisibleWhenIncomplete: {
    id: "dashboard/panel-visible-when-incomplete",
    summary: "A panel's visibleWhen names a non-empty query and field.",
    fix: "Set both visibleWhen.query and visibleWhen.field.",
  },
  panelSpanInvalid: {
    id: "dashboard/panel-span-invalid",
    summary: 'A panel\'s span is "half", "full", "third" or "two-thirds".',
    fix: 'Set span to "half", "full", "third" or "two-thirds".',
  },
  statGroupEmpty: {
    id: "dashboard/stat-group-empty",
    summary: "A stat-group declares at least one stat.",
    fix: "Add at least one stat.",
  },
  statGroupSubtitleWithoutLabel: {
    id: "dashboard/stat-group-subtitle-without-label",
    summary: "A stat-group with a subtitle also has a label.",
    fix: "Set a label or remove subtitle.",
  },
  statGroupChildVisibleWhen: {
    id: "dashboard/stat-group-child-visible-when",
    summary: "Stat-group children do not set visibleWhen.",
    fix: "Gate the whole group with visibleWhen instead.",
  },
  panelQueryEmpty: {
    id: "dashboard/panel-query-empty",
    summary: "A stat, stat-group child and query panel names a non-empty query string.",
    fix: "Set query to a registered query name.",
  },
  statValueFieldEmpty: {
    id: "dashboard/stat-value-field-empty",
    summary: "A stat panel and stat-group child has a non-empty valueField.",
    fix: "Set valueField to a field of the query result.",
  },
  customPanelNoComponent: {
    id: "dashboard/custom-panel-no-component",
    summary: "A custom panel declares a react or native component.",
    fix: "Declare a react/native component marker.",
  },
  listPanelColumnsEmpty: {
    id: "dashboard/list-panel-columns-empty",
    summary: "A list panel declares at least one column.",
    fix: "Add at least one column.",
  },
  filterIdEmpty: {
    id: "dashboard/filter-id-empty",
    summary: "The dashboard filter has a non-empty id.",
    fix: "Set a non-empty filter.id.",
  },
  filterLabelEmpty: {
    id: "dashboard/filter-label-empty",
    summary: "The dashboard filter has a non-empty label.",
    fix: "Set a non-empty filter.label.",
  },
  filterOptionsXor: {
    id: "dashboard/filter-options-xor",
    summary: "The dashboard filter sets exactly one of options and optionsQuery.",
    fix: "Keep either options or optionsQuery.",
  },
  filterOptionsEmpty: {
    id: "dashboard/filter-options-empty",
    summary: "Static filter options are non-empty.",
    fix: "Declare at least one option or use optionsQuery.",
  },
  filterOptionsQueryEmpty: {
    id: "dashboard/filter-options-query-empty",
    summary: "filter.optionsQuery is non-empty when set.",
    fix: "Set optionsQuery to a query name or remove it.",
  },
} as const satisfies BootRuleTable;
