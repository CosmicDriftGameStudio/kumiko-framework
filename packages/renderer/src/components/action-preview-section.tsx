import type {
  EditActionPreviewSectionViewModel,
  EditFieldViewModel,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import { groupIssuesByPath } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useMemo, useState } from "react";
import { dispatcherErrorText } from "../app/write-failed-error";
import { useDispatcher } from "../context/dispatcher-context";
import { useForm } from "../hooks/use-form";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import { GridCellForField } from "./grid-cell-for-field";
import { buildWriteFormSchema } from "./write-form-section";

export type ActionPreviewSectionProps = {
  readonly section: EditActionPreviewSectionViewModel;
  readonly featureName: string;
  readonly translate?: Translate;
  readonly hideTitle?: boolean;
};

// A "test run"/preview action for projectionDetail (see EditActionPreviewSection's
// doc). Deliberately has no onSubmitted/onReload prop — the handler's return
// value is shown, never persisted, and a run never triggers a refetch, which
// is the entire distinction from WriteFormSection. Dispatch is therefore NOT
// routed through useForm's `submit` config (which always calls
// dispatcher.write and rebases the form) — this component calls the
// dispatcher itself and picks write vs. query from the handler QN's type
// segment (boot-validated to be one or the other).
export function ActionPreviewSection({
  section,
  featureName,
  translate,
  hideTitle,
}: ActionPreviewSectionProps): ReactNode {
  const { Section, Grid, GridCell, Button, Banner } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const dispatcher = useDispatcher();

  const initial = useMemo(
    () => Object.fromEntries(section.fields.map((f: EditFieldViewModel) => [f.field, f.value])),
    [section.fields],
  );
  const schema = useMemo(() => buildWriteFormSchema(section.fields), [section.fields]);
  const { controller, snapshot } = useForm({ initial, schema });

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Readonly<Record<string, unknown>> | null>(null);

  async function handleRun(): Promise<void> {
    if (isRunning) return;
    if (!controller.validate()) return;
    setIsRunning(true);
    try {
      const isQuery = section.handler.includes(":query:");
      const outcome = isQuery
        ? await dispatcher.query(section.handler, snapshot.values)
        : await dispatcher.write(section.handler, snapshot.values);
      if (outcome.isSuccess) {
        setError(null);
        setResult(outcome.data as Readonly<Record<string, unknown>>);
        return;
      }
      setResult(null);
      const serverFields = outcome.error.details?.fields;
      if (serverFields && serverFields.length > 0) {
        controller.setErrors(groupIssuesByPath(serverFields));
      }
      setError(dispatcherErrorText(outcome.error, effectiveTranslate));
    } finally {
      setIsRunning(false);
    }
  }

  const resultFieldsWithValue = useMemo(
    () =>
      result === null ? [] : section.resultFields.map((f) => ({ ...f, value: result[f.field] })),
    [result, section.resultFields],
  );

  const content = (
    <>
      <Grid columns={section.columns}>
        {section.fields.map((field: EditFieldViewModel) => (
          <GridCellForField
            key={field.field}
            field={field}
            columns={section.columns}
            issues={snapshot.errors[field.field]}
            onChange={(v) => controller.setField(field.field, v)}
            GridCell={GridCell}
            featureName={featureName}
            allIssues={snapshot.errors}
            valueDisplay="form"
            row={snapshot.values}
          />
        ))}
      </Grid>
      {error !== null && (
        <Banner variant="error" testId="action-preview-section-error">
          {error}
        </Banner>
      )}
      <Button
        type="button"
        variant="primary"
        disabled={isRunning}
        loading={isRunning}
        onClick={() => void handleRun()}
        testId="action-preview-section-run"
      >
        {section.runLabel ?? effectiveTranslate("kumiko.actions.run")}
      </Button>
      {result !== null && (
        <Grid columns={section.columns} testId="action-preview-section-result">
          {resultFieldsWithValue.map((field) => (
            <GridCellForField
              key={field.field}
              field={field}
              columns={section.columns}
              issues={undefined}
              onChange={() => {}}
              GridCell={GridCell}
              featureName={featureName}
              allIssues={{}}
              valueDisplay="text"
              row={result}
            />
          ))}
        </Grid>
      )}
    </>
  );

  if (hideTitle || section.title === undefined) return content;
  return (
    <Section
      title={section.title}
      {...(section.icon !== undefined && { icon: section.icon })}
      testId={`action-preview-${section.title}`}
    >
      {content}
    </Section>
  );
}
