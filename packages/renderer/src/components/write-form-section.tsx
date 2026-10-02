import type {
  EditFieldViewModel,
  EditWriteFormSectionViewModel,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import { I18N_KEY_PARAM } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod";
import { isPresent, REQUIRED_FIELD_I18N_KEY } from "../app/form-schema.js";
import { dispatcherErrorText } from "../app/write-failed-error.js";
import { useForm } from "../hooks/use-form.js";
import { useTranslation } from "../i18n.js";
import { STICKY_PRIMARY_ACTION_PROP, usePrimitives } from "../primitives.js";
import { GridCellForField } from "./grid-cell-for-field.js";
import { hasIssueWithoutVisibleField } from "./render-edit-logic.js";

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
  /** section.actions, already resolved into buttons by the caller —
   *  rendered alongside (before) the section's own submit button in the
   *  title-row actions slot. */
  readonly actions?: ReactNode;
  /** Set when this section is a whole tab: the submit button is handed to
   *  the host form's footer (pinned like every other screen's save) instead
   *  of the section's title row. Called with undefined on unmount. */
  readonly onFooterAction?: (action: ReactNode | undefined) => void;
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
  actions,
  onFooterAction,
}: WriteFormSectionProps): ReactNode {
  const { Section, Card, Grid, GridCell, Button, Banner } = usePrimitives();
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
      // Field-level issues surface inline via snapshot.errors (same
      // GridCellForField/RenderField path RenderEdit uses) — the banner stays
      // for anything no rendered field can show (`version`, `id`, a root
      // refine, a hidden field).
      const issuePaths = (result.error.details?.fields ?? []).map((i) => i.path);
      setError(
        hasIssueWithoutVisibleField(issuePaths, section.fields)
          ? dispatcherErrorText(result.error, effectiveTranslate)
          : null,
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
  // The footer copy of the button outlives this render, so it calls the
  // latest handleSubmit through a ref instead of capturing a stale closure.
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;
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
    if (onFooterAction === undefined) return;
    onFooterAction(submitButton);
    return () => onFooterAction(undefined);
  }, [onFooterAction, isSubmitting, submitLabel]);

  const titleRowActions =
    onFooterAction !== undefined ? (
      actions
    ) : actions !== undefined ? (
      <>
        {actions}
        {submitButton}
      </>
    ) : (
      submitButton
    );

  // Section always flattens to a borderless divider when rendered inside
  // RenderEdit's own <Form> in tabs mode (hideTitle) — an unframed Card panel
  // stands in, like render-edit.tsx's tabs-mode fields/extension branches.
  if (hideTitle) {
    return (
      <Card
        options={{ framed: false }}
        slots={{
          ...(section.description !== undefined && { subtitle: section.description }),
          headerActions: titleRowActions,
        }}
        testId={`write-form-${section.title ?? section.handler}`}
      >
        {content}
      </Card>
    );
  }

  // Routed through Section's `actions` slot (same mechanism render-edit.tsx
  // uses via Form's `actions`) so the button gets the established right-
  // aligned footer treatment instead of stretching full-width inline.
  return (
    <Section
      {...(section.title !== undefined && { title: section.title })}
      {...(section.description !== undefined && { subtitle: section.description })}
      {...(section.icon !== undefined && { icon: section.icon })}
      actions={titleRowActions}
      testId={`write-form-${section.title ?? section.handler}`}
    >
      {content}
    </Section>
  );
}
