import type { FormDerivationScreen } from "@cosmicdrift/kumiko-framework/ui-types";
import { applyFormDerivations, isUnchangedValue } from "@cosmicdrift/kumiko-framework/ui-types";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";

/** The derived values that differ from the current form values, or undefined
 *  when everything is already up to date. A derived value that no longer
 *  resolves is reported as `undefined`. */
export function changedDerivedValues(
  values: unknown,
  screen: FormDerivationScreen,
): Record<string, unknown> | undefined {
  const next = applyFormDerivations(values, screen);
  if (!isPlainObject(values) || !isPlainObject(next)) return undefined;
  const patch: Record<string, unknown> = {};
  for (const target of Object.keys(screen.derive ?? {})) {
    if (!isUnchangedValue(values[target], next[target])) patch[target] = next[target];
  }
  return Object.keys(patch).length === 0 ? undefined : patch;
}

/** `values` with every derived field already resolved, so the form's baseline
 *  matches what the live recomputation would produce and starts out clean. */
export function withDerivedValues<TValues extends Record<string, unknown>>(
  values: TValues,
  screen: FormDerivationScreen | undefined,
): TValues {
  if (screen === undefined) return values;
  const patch = changedDerivedValues(values, screen);
  return patch === undefined ? values : { ...values, ...patch };
}
