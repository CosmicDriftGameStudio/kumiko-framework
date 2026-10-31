import type { BootRuleTable } from "./boot-rule.ts";

export const FORM_DERIVATION_RULES = {
  sourcesMoneyMixed: {
    id: "form-derive/sources-money-mixed",
    summary: "The sources of a sum or subtract derivation are all money or all number/decimal.",
    fix: "Use sources of one kind.",
  },
  targetKindMismatch: {
    id: "form-derive/target-kind-mismatch",
    summary: "A derivation's target is money exactly when its sources are money.",
    fix: "Change the target field type to match the sources.",
  },
  tooManyMoneySources: {
    id: "form-derive/too-many-money-sources",
    summary: "A derivation other than sum/subtract takes at most one money source.",
    fix: "Use at most one money source (for percent: the base, not the rate).",
  },
  percentNeedsTwoSources: {
    id: "form-derive/percent-needs-two-sources",
    summary: 'A "percent" derivation has exactly two sources (base, rate).',
    fix: "List base and rate in from.",
  },
  unknownSourceField: {
    id: "form-derive/unknown-source-field",
    summary: "Every derivation source is a field of the screen.",
    fix: "Name a field of this screen.",
  },
  sourceNotNumeric: {
    id: "form-derive/source-not-numeric",
    summary: "Every derivation source is a money, number or decimal field.",
    fix: "Use money, number or decimal source fields.",
  },
  unknownListField: {
    id: "form-derive/unknown-list-field",
    summary: "The list of a listSum derivation is a field of the screen.",
    fix: "Name a field of this screen.",
  },
  listNotEmbeddedList: {
    id: "form-derive/list-not-embedded-list",
    summary: "The list of a listSum derivation is an embedded list field.",
    fix: "Use an embedded field with multiple: true.",
  },
  cellNotNumeric: {
    id: "form-derive/cell-not-numeric",
    summary: "The cell of a listSum derivation is a money, number or decimal sub-field.",
    fix: "Name a numeric sub-field of the list.",
  },
  listSumKindMismatch: {
    id: "form-derive/list-sum-kind-mismatch",
    summary: "A listSum target is money exactly when its cell is money.",
    fix: "Change the target field type to match the cell.",
  },
  whenEmptyListSum: {
    id: "form-derive/when-empty-list-sum",
    summary: "whenEmpty of a listSum is not itself a listSum.",
    fix: "Use a from-based derivation as whenEmpty.",
  },
  unknownTarget: {
    id: "form-derive/unknown-target",
    summary: "Every derive key is a field of the screen.",
    fix: "Use a field name of this screen as key.",
  },
  targetNotNumeric: {
    id: "form-derive/target-not-numeric",
    summary: "A derived field is a money, number or decimal field.",
    fix: "Change the target field type to money, number or decimal.",
  },
  invalidOrder: {
    id: "form-derive/invalid-order",
    summary: "Derivations have a valid evaluation order (no cycles).",
    fix: "Remove the dependency cycle between derived fields.",
  },
  handlerNotWrapped: {
    id: "form-derive/handler-not-wrapped",
    summary: "A screen that declares derive uses a handler wrapped with withFormDerivations.",
    fix: "Wrap the handler schema: withFormDerivations(schema, screen) with this screen object.",
  },
} as const satisfies BootRuleTable;
