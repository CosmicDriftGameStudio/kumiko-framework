import type {
  EditFieldViewModel,
  EditWriteFormSectionViewModel,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import { I18N_KEY_PARAM } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useMemo, useState } from "react";
import { z } from "zod";
import { REQUIRED_FIELD_I18N_KEY } from "../app/form-schema";
import { dispatcherErrorText } from "../app/write-failed-error";
import { useForm } from "../hooks/use-form";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import { GridCellForField } from "./grid-cell-for-field";

// Same "has a value" rule as buildFormSchema's isPresent (app/form-schema.ts)
// — duplicated because that helper walks raw EditFieldSpec + EntityDefinition,
// unavailable here: this section only ever sees computeEditViewModel's
// already-resolved EditFieldViewModel[] (required/readOnly/visible are plain
// booleans by the time render-edit.tsx hands the section to this component).
function isPresent(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function buildWriteFormSchema(fields: readonly EditFieldViewModel[]): z.ZodType {
  return z
    .object({})
    .passthrough()
    .superRefine((values, ctx) => {
      const record = values as Record<string, unknown>;
      for (const field of fields) {
        if (field.readOnly || !field.visible || !field.required) continue;
        if (isPresent(record[field.field])) continue;
        ctx.addIssue({
          code: "custom",
          path: [field.field],
          message: `"${field.field}" is required.`,
          params: { [I18N_KEY_PARAM]: REQUIRED_FIELD_I18N_KEY },
        });
      }
    });
}

export type WriteFormSectionProps = {
  readonly section: EditWriteFormSectionViewModel;
  readonly featureName: string;
  readonly translate?: Translate;
  readonly hideTitle?: boolean;
  /** Fired after a successful submit — projectionDetail reloads its own
   *  record (a new one now exists) via a full RenderEdit remount, see
   *  ProjectionDetailBody's reloadNonce/key in kumiko-screen.tsx. */
  readonly onSubmitted: () => void;
};

// A self-persisting form section for projectionDetail (see
// EditWriteFormSection's doc). Deliberately NOT a nested <RenderEdit> — that
// would render a second, invalid nested <form> inside the host's own form
// element — so this mounts its own independent useForm() controller and
// submits via a plain button click instead of native form submission.
export function WriteFormSection({
  section,
  featureName,
  translate,
  hideTitle,
  onSubmitted,
}: WriteFormSectionProps): ReactNode {
  const { Section, Grid, GridCell, Button, Banner } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;

  const initial = useMemo(
    () => Object.fromEntries(section.fields.map((f: EditFieldViewModel) => [f.field, f.value])),
    [section.fields],
  );
  const schema = useMemo(() => buildWriteFormSchema(section.fields), [section.fields]);
  const { controller, snapshot } = useForm({
    initial,
    submit: { type: section.handler, payloadMode: "values" },
    schema,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(): Promise<void> {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await controller.submit();
      if (result.isSuccess) {
        setError(null);
        onSubmitted();
        return;
      }
      if (result.validationBlocked) return;
      // Field-level issues already surface inline via snapshot.errors (same
      // GridCellForField/RenderField path RenderEdit uses) — the banner is
      // only for form-level errors nothing else would show (fw#1901 pattern).
      const fieldIssues = result.error.details?.fields ?? [];
      setError(
        fieldIssues.length === 0 ? dispatcherErrorText(result.error, effectiveTranslate) : null,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

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
        <Banner variant="error" testId="write-form-section-error">
          {error}
        </Banner>
      )}
    </>
  );

  // type="button" (not "submit") is load-bearing: this section is deliberately
  // NOT a nested <form> (see the component doc above), so a "submit" type
  // would instead trigger the host RenderEdit's own form submit.
  const submitButton = (
    <Button
      type="button"
      variant="primary"
      icon="check"
      disabled={isSubmitting}
      loading={isSubmitting}
      onClick={() => void handleSubmit()}
      testId="write-form-section-submit"
    >
      {section.submitLabel ?? effectiveTranslate("kumiko.actions.save")}
    </Button>
  );

  // Routed through Section's `actions` slot (same mechanism render-edit.tsx
  // uses via Form's `actions`) so the button gets the established right-
  // aligned footer treatment instead of stretching full-width inline.
  return (
    <Section
      {...(!hideTitle && section.title !== undefined && { title: section.title })}
      {...(section.icon !== undefined && { icon: section.icon })}
      actions={submitButton}
      testId={`write-form-${section.title ?? "section"}`}
    >
      {content}
    </Section>
  );
}
