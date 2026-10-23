import type { FieldFillAction } from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { evalRowExtractor } from "../app/row-actions.ts";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import type { EditFieldViewModel } from "../headless/index.ts";
import { useTranslation } from "../i18n.tsx";
import type { InputFillAction, usePrimitives } from "../primitives.tsx";

const NUMERIC_FIELD_TYPES: ReadonlySet<string> = new Set(["number", "bigInt", "decimal"]);

// A text field takes a number as its string form; a numeric field takes only a
// number — a string would be sent as a wrong-typed value.
function fillValueFor(fieldType: string, result: unknown): string | number | undefined {
  if (NUMERIC_FIELD_TYPES.has(fieldType)) return typeof result === "number" ? result : undefined;
  if (typeof result === "string") return result;
  return typeof result === "number" ? String(result) : undefined;
}

// Owns the query state of a fill button. A separate component because RenderField
// returns early for hidden fields and the dispatcher hook must not be conditional.
export function FillActionControl({
  field,
  fillAction,
  row,
  onChange,
  disabled,
  Banner,
  renderControl,
}: {
  readonly field: EditFieldViewModel;
  readonly fillAction: FieldFillAction;
  readonly row: Readonly<Record<string, unknown>>;
  readonly onChange: (value: unknown) => void;
  readonly disabled: boolean;
  readonly Banner: ReturnType<typeof usePrimitives>["Banner"];
  readonly renderControl: (fill: InputFillAction) => ReactNode;
}): ReactNode {
  const dispatcher = useOptionalDispatcher();
  const t = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A newer click or an unmount cancels the in-flight query so a late answer
  // cannot overwrite a value the user has since typed.
  const activeRun = useRef<AbortController | null>(null);
  useEffect(() => () => activeRun.current?.abort(), []);

  const run = async (): Promise<void> => {
    if (dispatcher === undefined) {
      setFailed(true);
      return;
    }
    activeRun.current?.abort();
    const ctrl = new AbortController();
    activeRun.current = ctrl;
    setBusy(true);
    setFailed(false);
    const payload = fillAction.params === undefined ? {} : evalRowExtractor(fillAction.params, row);
    const result = await dispatcher.query<unknown>(fillAction.query, payload, {
      signal: ctrl.signal,
    });
    if (ctrl.signal.aborted) return;
    setBusy(false);
    if (!result.isSuccess) {
      setFailed(true);
      return;
    }
    const value = fillValueFor(field.type, propertyOf(result.data, fillAction.field));
    if (value === undefined) {
      setFailed(true);
      return;
    }
    onChange(value);
  };

  return (
    <>
      {renderControl({
        label: fillAction.label,
        onPress: () => void run(),
        busy,
        disabled,
        testId: `field-fill-${field.field}`,
      })}
      {failed && (
        <Banner variant="error" testId={`field-fill-error-${field.field}`}>
          {t("kumiko.field.fillAction.failed")}
        </Banner>
      )}
    </>
  );
}
