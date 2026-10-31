import type { ConfigEditAction } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import { useDispatcher } from "../context/dispatcher-context.tsx";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { useClientActionRuntime } from "./client-actions.tsx";
import { dispatcherErrorText } from "./write-failed-error.ts";

type Outcome = { readonly tone: "success" | "error"; readonly text: string };

// Calls the handler with `{}` and never touches the form: the button waits for a saved form so
// the handler works on what is stored, not on what is typed.
export function ConfigEditActionRow({
  action,
  dirty,
  translate,
}: {
  readonly action: ConfigEditAction;
  readonly dirty: boolean;
  readonly translate?: (key: string, params?: Readonly<Record<string, unknown>>) => string;
}): ReactNode {
  const { Field, Button, Banner, Text, Grid } = usePrimitives();
  const t = useTranslation();
  const translateKey = translate ?? t;
  const dispatcher = useDispatcher();
  const { notify } = useClientActionRuntime();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const report = (next: Outcome): void => {
    if (notify !== undefined) notify(next);
    else setOutcome(next);
  };

  const run = async (): Promise<void> => {
    setBusy(true);
    setOutcome(null);
    try {
      const result = await dispatcher.write(action.handler, {});
      if (!result.isSuccess) {
        report({ tone: "error", text: dispatcherErrorText(result.error, translateKey) });
      } else if (action.successMessage !== undefined) {
        report({ tone: "success", text: translateKey(action.successMessage) });
      }
    } catch {
      report({ tone: "error", text: translateKey("kumiko.form.error.generic") });
    } finally {
      setBusy(false);
    }
  };

  const saveFirst = translateKey("kumiko.configEdit.action.saveFirst");
  return (
    <Field
      id={`config-edit-action-${action.id}`}
      label={translateKey(action.label)}
      layout="row"
      {...(action.description !== undefined && { description: translateKey(action.description) })}
      testId={`config-edit-action-${action.id}`}
    >
      <Grid columns="auto">
        <Button
          type="button"
          variant="secondary"
          disabled={dirty || busy}
          loading={busy}
          title={dirty ? saveFirst : translateKey(action.buttonLabel)}
          onClick={run}
          testId={`config-edit-action-${action.id}-button`}
        >
          {translateKey(action.buttonLabel)}
        </Button>
      </Grid>
      {dirty && (
        <Text variant="small" testId={`config-edit-action-${action.id}-hint`}>
          {saveFirst}
        </Text>
      )}
      {outcome !== null && (
        <Banner
          variant={outcome.tone === "error" ? "error" : "info"}
          testId={`config-edit-action-${action.id}-outcome`}
        >
          {outcome.text}
        </Banner>
      )}
    </Field>
  );
}
