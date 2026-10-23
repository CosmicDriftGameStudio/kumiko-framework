import { useEffect, useMemo, useRef } from "react";
import { layoutEditFields } from "../app/layout-fields.ts";
import type { FormValues } from "../headless/index.ts";
import { type UseFormResult, useForm } from "../hooks/use-form.ts";
import { changedDerivedValues } from "./form-derivation-patch.ts";
import { deriveFormFields } from "./render-edit-helpers.tsx";
import { issuesAfterEdit } from "./render-edit-logic.ts";
import type { ResolvedRenderEditProps } from "./render-edit-render-model.ts";
import type { RenderEditState } from "./use-render-edit-state.ts";

export type RenderEditForm<TValues extends FormValues> = UseFormResult<TValues> & {
  readonly scopeFieldNames: readonly string[] | undefined;
  readonly writeVerb: "create" | "update";
  readonly clearErrorsOnInput: (changedField: string) => void;
};

// Must be computed before submitConfig/useForm bakes it in (the controller
// freezes it on first render). This is the unfiltered field-name set from
// `fieldsFilter` ∩ `fields` — not the value-dependent `filteredSections`
// (which also drops `section.visible === false`). Hidden fields still fall
// out via form-controller's `hiddenFields` path. undefined = unscoped, since
// scoping would silently drop root-level .refine() issues.
// A `fieldsFilter` that matches nothing in `fields` (typo, renamed field)
// must fall back to unscoped too — an empty scope array would filter out
// ALL validation issues, letting submit() through
// unvalidated on a form that also renders no sections.
function useScopeFieldNames(
  fieldsFilter: readonly string[] | undefined,
  fields: Readonly<Record<string, unknown>>,
): readonly string[] | undefined {
  return useMemo(() => {
    if (fieldsFilter === undefined) return undefined;
    const matched = fieldsFilter.filter((f) => Object.hasOwn(fields, f));
    return matched.length === 0 ? undefined : matched;
  }, [fieldsFilter, fields]);
}

// A write-excluded field must never reach the payload: the handler schema is
// z.never() for it, so even an unchanged read-only value would be rejected.
function useOmitFields(
  screen: ResolvedRenderEditProps<FormValues>["screen"],
  writeVerb: "create" | "update",
): readonly string[] {
  return useMemo(
    () => [
      ...layoutEditFields(screen)
        .filter((spec) => spec.submit === false)
        .map((spec) => spec.field),
      ...(screen.writeExcludedFields?.[writeVerb] ?? []),
    ],
    [screen, writeVerb],
  );
}

function buildSubmitConfig<TValues extends FormValues, TCtx>(
  props: ResolvedRenderEditProps<TValues, TCtx>,
  omitFields: readonly string[],
  scopeFieldNames: readonly string[] | undefined,
) {
  const { writeCommand, payloadMode, buildPayload, serverFieldPathPrefix } = props;
  return writeCommand !== undefined
    ? {
        type: writeCommand,
        payloadMode,
        ...(buildPayload !== undefined && { buildPayload }),
        ...(omitFields.length > 0 && { omitFields }),
        ...(serverFieldPathPrefix !== undefined && { serverFieldPathPrefix }),
        ...(scopeFieldNames !== undefined && { validateScope: scopeFieldNames }),
      }
    : undefined;
}

export function useRenderEditForm<TValues extends FormValues, TCtx>(
  props: ResolvedRenderEditProps<TValues, TCtx>,
  state: RenderEditState,
): RenderEditForm<TValues> {
  const { screen, initial, schema, ctx, formDerivation, refreshToken } = props;
  const fields = useMemo(() => deriveFormFields<TValues, TCtx>(screen), [screen]);
  const scopeFieldNames = useScopeFieldNames(props.fields, fields);

  // Configure submission only when the caller provides a writeCommand; with
  // customSubmit, the form controller has no submit wiring because
  // controller.submit() is not called.
  const writeVerb = state.isCreateMode ? "create" : "update";
  const omitFields = useOmitFields(screen, writeVerb);
  const submitConfig = buildSubmitConfig(props, omitFields, scopeFieldNames);

  const { controller, snapshot } = useForm<TValues, TCtx>({
    initial,
    fields,
    ...(schema !== undefined && { schema }),
    ...(ctx !== undefined && { ctx }),
    ...(submitConfig !== undefined && { submit: submitConfig }),
  });

  // Derived fields are written into form state (not only displayed) so required
  // validation and the submit payload carry them; only a real change is set, which
  // keeps this from looping.
  useEffect(() => {
    // skip: screen has no derived fields
    if (formDerivation === undefined) return;
    const patch = changedDerivedValues(snapshot.values, formDerivation);
    if (patch !== undefined) controller.setValues(patch as Partial<TValues>); // @cast-boundary form-values
  }, [snapshot.values, formDerivation, controller]);

  // Wired at the user-input boundary, not in controller.setField: computed
  // fields, prefill, draft restore and action patches also call setValues
  // after a failed submit and must not wipe the errors.
  const clearErrorsOnInput = (changedField: string): void => {
    const errors = controller.getSnapshot().errors;
    const remaining = issuesAfterEdit(errors, changedField);
    if (remaining !== errors) controller.setErrors(remaining);
    if (state.formErrorSource === "submit" && state.formError?.code !== "version_conflict") {
      state.setFormError(null);
    }
  };

  const lastRefreshTokenRef = useRef(refreshToken);
  useEffect(() => {
    // skip: refreshToken unchanged
    if (lastRefreshTokenRef.current === refreshToken) return;
    lastRefreshTokenRef.current = refreshToken;
    // skip: never overwrite user input, a dirty form keeps its values.
    if (controller.getSnapshot().isDirty) return;
    controller.setValues(initial);
    controller.rebase();
  }, [refreshToken, controller, initial]);

  return { controller, snapshot, scopeFieldNames, writeVerb, clearErrorsOnInput };
}
