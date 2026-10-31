import type { BootRuleTable } from "./boot-rule.ts";

export const FORM_LAYOUT_RULES = {
  tabsTooFewSections: {
    id: "form/tabs-too-few-sections",
    summary: "A tabs layout has at least two sections.",
    fix: "Add a section or use another mode.",
  },
  tabTitleMissing: {
    id: "form/tab-title-missing",
    summary: "Every tab section has a non-empty title.",
    fix: "Give each tab section a title.",
  },
  tabIdMissing: {
    id: "form/tab-id-missing",
    summary: "Every tab section has a non-empty id.",
    fix: "Give each tab section a stable id.",
  },
  tabIdNotKebab: {
    id: "form/tab-id-not-kebab",
    summary: "Tab section ids are kebab-case.",
    fix: "Rename the section id to kebab-case.",
  },
  tabIdDuplicate: {
    id: "form/tab-id-duplicate",
    summary: "Tab section ids are unique.",
    fix: "Give each tab section a unique id.",
  },
  tabsUnsupportedScreenType: {
    id: "form/tabs-unsupported-screen-type",
    summary: "Tabs layout is used only on projectionDetail and entityEdit screens.",
    fix: 'Use mode: "wizard" or "single".',
  },
  draftWithoutWizard: {
    id: "form/draft-without-wizard",
    summary: "layout.draft is set only on a wizard layout.",
    fix: 'Remove draft: true or set mode: "wizard".',
  },
  draftFeatureMissing: {
    id: "form/draft-feature-missing",
    summary: "A draft layout needs the form-draft feature mounted.",
    fix: "Add createFormDraftFeature() from @cosmicdrift/kumiko-bundled-features to the app's features.",
  },
  wizardTooFewSections: {
    id: "form/wizard-too-few-sections",
    summary: "A wizard layout has at least two sections.",
    fix: "Add a section or use another mode.",
  },
  wizardStepTitleMissing: {
    id: "form/wizard-step-title-missing",
    summary: "Every wizard section has a non-empty title.",
    fix: "Give each wizard section a title.",
  },
  sectionFieldsAndGroups: {
    id: "form/section-fields-and-groups",
    summary: "A section declares fields or groups, not both.",
    fix: "Remove `fields: []` when using groups.",
  },
  sectionEmpty: {
    id: "form/section-empty",
    summary: "A section declares at least one field or group.",
    fix: "Drop the section or add fields or groups.",
  },
  sectionsEmpty: {
    id: "form/sections-empty",
    summary: "An inline form layout declares at least one section.",
    fix: "Declare at least one section.",
  },
  extensionSectionNoComponent: {
    id: "form/extension-section-no-component",
    summary: "An extension section declares a react or native component.",
    fix: "Declare a react/native component marker.",
  },
  relatedListSectionUnsupported: {
    id: "form/related-list-section-unsupported",
    summary: "Inline form layouts have no relatedList sections.",
    fix: "Move the section to a projectionDetail screen or remove it.",
  },
  writeFormSectionUnsupported: {
    id: "form/write-form-section-unsupported",
    summary: "Inline form layouts have no writeForm sections.",
    fix: "Move the section to a projectionDetail screen or remove it.",
  },
  layoutUnknownField: {
    id: "form/layout-unknown-field",
    summary: "Layout fields name fields of the form.",
    fix: "Name an existing field of the form.",
  },
  successFactsWithRedirect: {
    id: "form/success-facts-with-redirect",
    summary: "An actionForm sets either redirect or successFacts.",
    fix: "Use one of them.",
  },
  successLinksWithRedirect: {
    id: "form/success-links-with-redirect",
    summary: "An actionForm sets either redirect or successLinks.",
    fix: "Use one of them.",
  },
  loadSingletonWithIdParam: {
    id: "form/load-singleton-with-id-param",
    summary: "A singleton actionForm load has no idParam.",
    fix: "Remove idParam.",
  },
  confirmLayoutMode: {
    id: "form/confirm-layout-mode",
    summary: "A secretMint confirm layout is a single-step form.",
    fix: 'Remove mode or set it to "single".',
  },
  confirmLayoutDraft: {
    id: "form/confirm-layout-draft",
    summary: "A secretMint confirm layout does not persist drafts.",
    fix: "Remove draft: true.",
  },
  confirmCarryEntryEmpty: {
    id: "form/confirm-carry-entry-empty",
    summary: "secretMint confirm.carry entries are non-empty strings.",
    fix: "Use non-empty strings in carry.",
  },
  confirmCarryCollidesField: {
    id: "form/confirm-carry-collides-field",
    summary: "A confirm.carry entry does not share a name with a confirm.fields entry.",
    fix: "Rename the carry entry or the field.",
  },
} as const satisfies BootRuleTable;
