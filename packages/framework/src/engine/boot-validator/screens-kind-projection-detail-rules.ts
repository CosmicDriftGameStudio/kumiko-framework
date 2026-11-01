import type { BootRuleTable } from "./boot-rule.ts";

export const PROJECTION_DETAIL_RULES = {
  singletonWithIdParam: {
    id: "projection-detail/singleton-with-id-param",
    summary: "A singleton projectionDetail sets no idParam.",
    fix: "Remove idParam.",
  },
  singletonWithDetailFor: {
    id: "projection-detail/singleton-with-detail-for",
    summary: "A singleton projectionDetail sets no detailFor.",
    fix: "Remove detailFor, or declare an explicit edit action.",
  },
  headerWithRecordTitleField: {
    id: "projection-detail/header-with-record-title-field",
    summary: "A projectionDetail with a header sets no recordTitleField.",
    fix: "Drop recordTitleField; header.title names the record.",
  },
  tabsSectionGroupsAndActions: {
    id: "projection-detail/tabs-section-groups-and-actions",
    summary: "A tabs-mode section declares groups or actions, not both.",
    fix: "Move the actions onto one group's title, or drop groups.",
  },
  metricNavigateTabUnknown: {
    id: "projection-detail/metric-navigate-tab-unknown",
    summary: "A metric navigate.tab names a section id of the screen.",
    fix: "Navigate to an existing section id or remove navigate.tab.",
  },
  actionShowOnTabsInvalid: {
    id: "projection-detail/action-show-on-tabs-invalid",
    summary:
      'A header action showOnTabs is non-empty, names section ids of the screen and needs layout.mode "tabs".',
    fix: "List existing section ids or remove showOnTabs.",
  },
  metricLabelMissing: {
    id: "projection-detail/metric-label-missing",
    summary: "Every metric has an i18n label key.",
    fix: "Set label on the metric.",
  },
  statusToneInvalid: {
    id: "projection-detail/status-tone-invalid",
    summary: "header.statusTones values are known select option tones.",
    fix: "Use one of SELECT_OPTION_TONES.",
  },
  statusFormatWithoutStatus: {
    id: "projection-detail/status-format-without-status",
    summary: "header.statusFormat is only set together with header.status.",
    fix: "Set header.status or remove statusFormat.",
  },
  subtitleHrefWithMultiPart: {
    id: "projection-detail/subtitle-href-with-multi-part",
    summary: "header.subtitleHref is only set with the string form of header.subtitle.",
    fix: "Use a single-field subtitle or remove subtitleHref.",
  },
  subtitlePartDuplicate: {
    id: "projection-detail/subtitle-part-duplicate",
    summary: "Each field appears once in header.subtitle.",
    fix: "List each field once.",
  },
  subtitlePartNavigateTargetMissing: {
    id: "projection-detail/subtitle-part-navigate-target-missing",
    summary: "A header.subtitle part navigate names a screen or an entity.",
    fix: "Set screen or entity on the part's navigate.",
  },
  extensionContributesToFormSubmit: {
    id: "projection-detail/extension-contributes-to-form-submit",
    summary: "A projectionDetail extension section does not set contributesToFormSubmit.",
    fix: "Omit contributesToFormSubmit and persist through the extension's own dispatcher writes.",
  },
  extensionEntityNameMissing: {
    id: "projection-detail/extension-entity-name-missing",
    summary: "A projectionDetail extension section declares entityName.",
    fix: "Set entityName to the domain entity the extension persists against.",
  },
  wizardRelatedList: {
    id: "projection-detail/wizard-related-list",
    summary: "A wizard-mode layout has no relatedList section.",
    fix: 'Remove mode: "wizard" or drop the relatedList section.',
  },
  writeFormFieldDefsEmpty: {
    id: "projection-detail/write-form-field-defs-empty",
    summary: "A writeForm section declares at least one fieldDefs entry.",
    fix: "Declare at least one field type.",
  },
  writeFormFieldsEmpty: {
    id: "projection-detail/write-form-fields-empty",
    summary: "A writeForm section lists at least one field.",
    fix: "Drop the section or add fields.",
  },
  writeFormFieldWithoutDef: {
    id: "projection-detail/write-form-field-without-def",
    summary: "Every rendered writeForm field has a fieldDefs entry.",
    fix: "Add the field to fieldDefs.",
  },
  wizardWriteForm: {
    id: "projection-detail/wizard-write-form",
    summary: "A wizard-mode layout has no writeForm section.",
    fix: 'Remove mode: "wizard" or drop the writeForm section.',
  },
} as const satisfies BootRuleTable;
