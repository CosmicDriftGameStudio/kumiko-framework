import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod";
import { type ErrorNotice, ErrorReference } from "../app/error-reference.tsx";
import { isPresent, REQUIRED_FIELD_I18N_KEY } from "../app/form-schema.ts";
import { dispatcherErrorText } from "../app/write-failed-error.ts";
import { stripUntouchedEmptyStrings } from "../headless/form/form-controller.ts";
import type {
  EditFieldViewModel,
  EditWriteFormSectionViewModel,
  Translate,
} from "../headless/index.ts";
import { I18N_KEY_PARAM } from "../headless/index.ts";
import { useForm } from "../hooks/use-form.ts";
import { useTranslation } from "../i18n.tsx";
import { useUnsavedInputSource } from "../leave-guard.ts";
import { STICKY_PRIMARY_ACTION_PROP, usePrimitives } from "../primitives.tsx";
import { GridCellForField } from "./grid-cell-for-field.tsx";
import { narrowAwareDescription } from "./narrow-description.tsx";
import { appendixCellProps } from "./render-edit-field-grid.tsx";
import { hasIssueWithoutVisibleField, issuesAfterEdit } from "./render-edit-logic.ts";
import { useWriteFormRegistry } from "./write-form-registry.ts";

function buildWriteFormSchema(fields: readonly EditFieldViewModel[]): z.ZodType {
  return z
    .object({})
    .passthrough()
    .superRefine((values, ctx) => {
      for (const field of fields) {
        if (field.readOnly || !field.visible || !field.required) continue;
        if (isPresent(values[field.field])) continue;
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
  /** Small uppercase label instead of a heading (record pages). */
  readonly labelTitle?: boolean;
  /** Fired after a successful submit, once this section reset itself to its
   *  initial values — projectionDetail refetches its record (a new one now
   *  exists), see ProjectionDetailBody's reloadNonce in kumiko-screen.tsx. */
  readonly onSubmitted: () => void;
  /** The screen's record: hintField and badge fall back to it for fields the form does not hold. */
  readonly recordValues?: Readonly<Record<string, unknown>>;
  /** section.actions, already resolved into buttons by the caller —
   *  rendered in the title row, apart from the section's own submit button. */
  readonly actions?: ReactNode;
  /** Set when this section is a whole tab: the submit button is handed to
   *  the host form's footer (pinned like every other screen's save) instead
   *  of the end of the section body. Called with undefined on unmount. */
  readonly onFooterAction?: (action: ReactNode | undefined) => void;
};

// Only an error no rendered field can show gets the banner.
function submitErrorNotice(
  error: Parameters<typeof dispatcherErrorText>[0],
  fields: readonly EditFieldViewModel[],
  translate: Translate,
): ErrorNotice | null {
  const issuePaths = (error.details?.fields ?? []).map((i) => i.path);
  if (!hasIssueWithoutVisibleField(issuePaths, fields)) return null;
  return {
    message: dispatcherErrorText(error, translate),
    ...(error.requestId !== undefined && { requestId: error.requestId }),
  };
}

// An action with `submitWith` validates and reads this form through the registry.
type FormController = ReturnType<typeof useForm>["controller"];

function useRegisterWriteForm(
  submitWith: string | undefined,
  controller: FormController,
  fields: readonly EditFieldViewModel[],
): void {
  const registry = useWriteFormRegistry();
  useEffect(() => {
    if (submitWith === undefined || registry === null) return;
    registry.set(submitWith, {
      validate: () => controller.validate(),
      invalidFieldLabels: () =>
        Object.keys(controller.getSnapshot().errors).map(
          (path) => fields.find((f: EditFieldViewModel) => f.field === path)?.label ?? path,
        ),
      // Same as controller.submit: an untouched "" would fail an optional enum/email/date in the schema.
      getValues: () => {
        const { values, initial } = controller.getSnapshot();
        return stripUntouchedEmptyStrings(values, initial, new Set());
      },
      rebase: () => controller.rebase(),
    });
    return () => {
      registry.delete(submitWith);
    };
  }, [registry, submitWith, controller, fields]);
}

function WriteFormFeedback({
  error,
  submitRow,
}: {
  readonly error: ErrorNotice | null;
  readonly submitRow: ReactNode;
}): ReactNode {
  const { Banner, Card } = usePrimitives();
  return (
    <>
      {error !== null && (
        <Banner variant="error" testId="write-form-section-error">
          {error.message}
          <ErrorReference requestId={error.requestId} />
        </Banner>
      )}
      {submitRow !== null && (
        <Card
          options={{ framed: false, footerBordered: false, footerInset: false }}
          slots={{ footer: submitRow }}
          testId="write-form-section-submit-row"
        />
      )}
    </>
  );
}

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
  labelTitle,
  onSubmitted,
  recordValues,
  actions,
  onFooterAction,
}: WriteFormSectionProps): ReactNode {
  const { Section, Card, Grid, GridCell, Button, StatusBadge } = usePrimitives();
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
  useUnsavedInputSource(() => controller.getSnapshot().isDirty);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<ErrorNotice | null>(null);
  const { submitWith } = section;
  useRegisterWriteForm(submitWith, controller, section.fields);

  async function handleSubmit(): Promise<void> {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await controller.submit();
      if (result.isSuccess) {
        setError(null);
        // Edits typed while the write was in flight stay; only a clean form is reset.
        if (!controller.getSnapshot().isDirty) {
          controller.setValues(initial);
          controller.rebase();
        }
        onSubmitted();
        return;
      }
      if (result.validationBlocked) return;
      // Field-level issues surface inline via snapshot.errors (same
      // GridCellForField/RenderField path RenderEdit uses) — the banner stays
      // for anything no rendered field can show (`version`, `id`, a root
      // refine, a hidden field).
      setError(submitErrorNotice(result.error, section.fields, effectiveTranslate));
    } finally {
      setIsSubmitting(false);
    }
  }

  // type="button" (not "submit") is load-bearing: this section is deliberately
  // NOT a nested <form> (see the component doc above), so a "submit" type
  // would instead trigger the host RenderEdit's own form submit.
  // The footer copy of the button outlives this render, so it calls the
  // latest handleSubmit through a ref instead of capturing a stale closure.
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;
  const sectionTestId = `write-form-${section.title ?? section.handler}`;
  const submitLabel = section.submitLabel ?? effectiveTranslate("kumiko.actions.save");
  const submitButton = (
    <Button
      type="button"
      variant="primary"
      disabled={isSubmitting}
      loading={isSubmitting}
      onClick={() => void handleSubmitRef.current()}
      testId="write-form-section-submit"
      {...{ [STICKY_PRIMARY_ACTION_PROP]: true }}
    >
      {submitLabel}
    </Button>
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: submitButton is rebuilt every render; isSubmitting and submitLabel are everything it shows.
  useEffect(() => {
    if (onFooterAction === undefined || submitWith !== undefined) return;
    onFooterAction(submitButton);
    return () => onFooterAction(undefined);
  }, [onFooterAction, submitWith, isSubmitting, submitLabel]);

  const content = (
    <>
      <Grid columns={section.columns}>
        {section.fields.map((field: EditFieldViewModel) => (
          <GridCellForField
            key={field.field}
            field={{ ...field, value: snapshot.values[field.field] }}
            columns={section.columns}
            issues={snapshot.errors[field.field]}
            onChange={(v) => {
              controller.setField(field.field, v);
              const errors = controller.getSnapshot().errors;
              const remaining = issuesAfterEdit(errors, field.field);
              if (remaining !== errors) controller.setErrors(remaining);
              setError(null);
            }}
            GridCell={GridCell}
            featureName={featureName}
            {...appendixCellProps({}, field, { ...recordValues, ...snapshot.values }, StatusBadge)}
            allIssues={snapshot.errors}
            valueDisplay="form"
            row={snapshot.values}
            {...(hideTitle !== true &&
              section.title !== undefined && { sectionTitle: section.title })}
          />
        ))}
      </Grid>
      <WriteFormFeedback
        error={error}
        submitRow={onFooterAction === undefined && submitWith === undefined ? submitButton : null}
      />
    </>
  );

  // Section always flattens to a borderless divider when rendered inside
  // RenderEdit's own <Form> in tabs mode (hideTitle) — an unframed Card panel
  // stands in, like render-edit.tsx's tabs-mode fields/extension branches.
  if (hideTitle) {
    return (
      <Card
        options={{ framed: false }}
        slots={{
          ...(section.description !== undefined && {
            subtitle: narrowAwareDescription(section.description, section.descriptionNarrow),
          }),
          ...(actions !== undefined && { headerActions: actions }),
        }}
        testId={sectionTestId}
      >
        {content}
      </Card>
    );
  }

  return (
    <Section
      {...(section.title !== undefined && { title: section.title })}
      {...(labelTitle === true && { titleStyle: "label" as const })}
      {...(section.description !== undefined && {
        subtitle: narrowAwareDescription(section.description, section.descriptionNarrow),
      })}
      {...(section.icon !== undefined && { icon: section.icon })}
      {...(actions !== undefined && { actions })}
      testId={sectionTestId}
    >
      {content}
    </Section>
  );
}
