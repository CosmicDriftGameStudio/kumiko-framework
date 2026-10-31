import type { BootRuleTable } from "./boot-rule.ts";

export const SCREEN_RULES = {
  customNoComponent: {
    id: "screen/custom-no-component",
    summary: "A custom screen renderer declares a react or native component.",
    fix: "Set react or native on the renderer.",
  },
  unknownType: {
    id: "screen/unknown-type",
    summary: "A screen has a known type.",
    fix: "Use a supported screen type.",
  },
  urlPrefillFieldsSet: {
    id: "screen/url-prefill-fields-set",
    summary: "Screens do not set urlPrefillFields; buildAppSchema derives it.",
    fix: "Declare params on the navigating action instead.",
  },
  submitPrefilledUnsupported: {
    id: "screen/submit-prefilled-unsupported",
    summary: "Only actionForm and secretMint screens set submitPrefilled.",
    fix: "Remove submitPrefilled.",
  },
  submitPrefilledHiddenRequired: {
    id: "screen/submit-prefilled-hidden-required",
    summary:
      "With submitPrefilled, a hidden required field is passed in by a navigate action's params.",
    fix: "Add the field to the params of a navigate action targeting the screen, make it visible, or drop required.",
  },
  customWriteQnUnregistered: {
    id: "screen/custom-write-qn-unregistered",
    summary: "Every dispatcher.write QN in app source names a registered write handler.",
    fix: "Check the spelling against registered write handlers (<feature>:write:<handler>).",
  },
  detailForDuplicate: {
    id: "screen/detail-for-duplicate",
    summary: "At most one screen declares detailFor for an entity.",
    fix: "Keep detailFor on one screen per entity.",
  },
  detailForUnknownEntity: {
    id: "screen/detail-for-unknown-entity",
    summary: "detailFor names an entity a feature registers.",
    fix: "Set detailFor to a registered entity name or remove it.",
  },
  actionFieldFunction: {
    id: "screen/action-field-function",
    summary: "Action payload, params, entityId and visible are declarative values, not functions.",
    fix: "Use the declarative DSL ({ pick }, { map }, field name, { field, eq }).",
  },
  editFieldConditionFunction: {
    id: "screen/edit-field-condition-function",
    summary: "Edit field visible, readOnly and required are FieldConditions, not functions.",
    fix: "Use a FieldCondition (boolean or { field, eq/ne/in/notIn }).",
  },
  rendererFunction: {
    id: "screen/renderer-function",
    summary: "Field and column renderers are FormatSpecs, not functions.",
    fix: 'Use a FormatSpec ({ format: "..." }).',
  },
} as const satisfies BootRuleTable;
