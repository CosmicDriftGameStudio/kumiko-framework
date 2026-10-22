import { orderFormDerivations } from "../form-derivations.ts";
import { parseQn } from "../qualified-name.ts";
import type { FeatureDefinition } from "../types/feature.ts";
import type { ActionFormScreenDefinition, FormFieldDerivation } from "../types/screen.ts";
import { formDerivationsOfSchema } from "../with-form-derivations.ts";

const NUMERIC_FORM_FIELD_TYPES: readonly string[] = ["money", "number", "decimal"];
const NUMERIC_SUB_FIELD_TYPES: readonly string[] = ["money", "number", "decimal"];

type DerivationCheck = {
  readonly prefix: string;
  readonly screen: ActionFormScreenDefinition;
  readonly target: string;
};

function isMoneyType(type: string | undefined): boolean {
  return type === "money";
}

// Money operands are computed in minor units, number/decimal in major units: mixing them
// silently scales the result by 100 or 10000.
function validateUnitCompatibility(
  { prefix, screen, target }: DerivationCheck,
  derivation: Extract<FormFieldDerivation, { from: unknown }>,
): void {
  const targetIsMoney = isMoneyType(screen.fields[target]?.type);
  const moneyFlags = derivation.from.map((source) => isMoneyType(screen.fields[source]?.type));
  const moneyCount = moneyFlags.filter(Boolean).length;
  if (derivation.op === "sum" || derivation.op === "subtract") {
    if (moneyCount !== 0 && moneyCount !== moneyFlags.length) {
      throw new Error(
        `${prefix}.${target}: "${derivation.op}" sources must be all money or all number/decimal.`,
      );
    }
    if (moneyCount > 0 !== targetIsMoney) {
      throw new Error(
        `${prefix}.${target}: a "${derivation.op}" over ${moneyCount > 0 ? "money" : "number/decimal"} sources needs a ${moneyCount > 0 ? "money" : "number/decimal"} target.`,
      );
    }
    // skip: sum/subtract fully validated above.
    return;
  }
  if (moneyCount > 1 || (derivation.op === "percent" && moneyFlags[1] === true)) {
    throw new Error(
      `${prefix}.${target}: "${derivation.op}" takes at most one money source${derivation.op === "percent" ? " (the base, not the rate)" : ""}.`,
    );
  }
  if ((moneyCount === 1) !== targetIsMoney) {
    throw new Error(
      `${prefix}.${target}: the target must be money exactly when a "${derivation.op}" source is money.`,
    );
  }
}

function validateFromList(
  { prefix, screen, target }: DerivationCheck,
  derivation: Extract<FormFieldDerivation, { from: unknown }>,
): void {
  if (derivation.op === "percent" && derivation.from.length !== 2) {
    throw new Error(`${prefix}.${target}: "percent" needs exactly two sources (base, rate).`);
  }
  for (const source of derivation.from) {
    const sourceField = screen.fields[source];
    if (sourceField === undefined) {
      throw new Error(
        `${prefix}.${target}: unknown source field "${source}". Name a field of this screen.`,
      );
    }
    if (!NUMERIC_FORM_FIELD_TYPES.includes(sourceField.type)) {
      throw new Error(
        `${prefix}.${target}: source "${source}" must be money, number or decimal, not "${sourceField.type}".`,
      );
    }
  }
  validateUnitCompatibility({ prefix, screen, target }, derivation);
}

function validateListSum(
  check: DerivationCheck,
  derivation: Extract<FormFieldDerivation, { op: "listSum" }>,
): void {
  const { prefix, screen, target } = check;
  const listField = screen.fields[derivation.list];
  if (listField === undefined) {
    throw new Error(`${prefix}.${target}: unknown list field "${derivation.list}".`);
  }
  if (listField.type !== "embedded" || listField.multiple !== true) {
    throw new Error(
      `${prefix}.${target}: "${derivation.list}" must be an embedded list field (multiple: true).`,
    );
  }
  const cellType = listField.schema[derivation.cell]?.type;
  if (cellType === undefined || !NUMERIC_SUB_FIELD_TYPES.includes(cellType)) {
    throw new Error(
      `${prefix}.${target}: "${derivation.cell}" must be a money, number or decimal sub-field of "${derivation.list}".`,
    );
  }
  if (isMoneyType(cellType) !== isMoneyType(screen.fields[target]?.type)) {
    throw new Error(
      `${prefix}.${target}: a listSum of a ${isMoneyType(cellType) ? "money" : "number/decimal"} cell needs a ${isMoneyType(cellType) ? "money" : "number/decimal"} target.`,
    );
  }
  const { whenEmpty } = derivation;
  // skip: whenEmpty is optional
  if (whenEmpty === undefined) return;
  // Type forbids a nested listSum; JS/cast callers can still pass one.
  if (!("from" in whenEmpty)) {
    throw new Error(`${prefix}.${target}: whenEmpty must not be a listSum.`);
  }
  validateFromList(check, whenEmpty);
}

// actionForm `derive`: every name must resolve, targets must be numeric, a
// listSum must point at a numeric cell of an embedded list, no cycles.
export function validateFormDerivations(
  featureName: string,
  screenId: string,
  screen: ActionFormScreenDefinition,
): void {
  const derive = screen.derive;
  // skip: the screen derives nothing
  if (derive === undefined) return;
  const prefix = `[Feature ${featureName}] Screen "${screenId}" (actionForm) derive`;

  for (const [target, derivation] of Object.entries(derive)) {
    const targetField = screen.fields[target];
    if (targetField === undefined) {
      throw new Error(`${prefix}: key "${target}" is not a field of this screen.`);
    }
    if (!NUMERIC_FORM_FIELD_TYPES.includes(targetField.type)) {
      throw new Error(
        `${prefix}.${target}: a derived field must be money, number or decimal, not "${targetField.type}".`,
      );
    }
    const check = { prefix, screen, target };
    if (derivation.op === "listSum") validateListSum(check, derivation);
    else validateFromList(check, derivation);
  }

  try {
    orderFormDerivations(derive);
  } catch (error) {
    throw new Error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Secure by default: a derive the handler schema doesn't recompute would let a
// client send its own totals, so the handler must wrap with this very screen.
export function validateFormDerivationsEnforced(
  featureName: string,
  screenId: string,
  screen: ActionFormScreenDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): void {
  // skip: the screen derives nothing
  if (screen.derive === undefined) return;
  const { scope, name } = parseQn(screen.handler);
  const schema = featureMap.get(scope)?.writeHandlers[name]?.schema;
  // skip: wrapped with this screen
  if (formDerivationsOfSchema(schema) === screen.derive) return;
  throw new Error(
    `[Feature ${featureName}] Screen "${screenId}" (actionForm) declares derive, but handler ` +
      `"${screen.handler}" does not recompute it on the server. Wrap the handler schema: ` +
      `withFormDerivations(schema, screen) with this screen object.`,
  );
}
