import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as z from "zod";
import { type ErrorNotice, ErrorReference } from "../app/error-reference.tsx";
import { isPresent, REQUIRED_FIELD_I18N_KEY } from "../app/form-schema.ts";
import { dispatcherErrorText } from "../app/write-failed-error.ts";
import { stripUntouchedEmptyStrings } from "../headless/form/form-controller.ts";
import type {
  EditFieldViewModel,
  EditSectionViewModel,
  EditWriteFormSectionViewModel,
  Translate,
} from "../headless/index.ts";
import { I18N_KEY_PARAM } from "../headless/index.ts";
import { useForm } from "../hooks/use-form.ts";
import { useTranslation } from "../i18n.tsx";
import { NarrowFileInputProvider, useInsideDrawer } from "../inside-drawer.ts";
import { useUnsavedInputSource } from "../leave-guard.ts";
import { STICKY_PRIMARY_ACTION_PROP, usePrimitives } from "../primitives.tsx";
import { GridCellForField } from "./grid-cell-for-field.tsx";
import { narrowAwareDescription } from "./narrow-description.tsx";
import { appendixCellProps } from "./render-edit-field-grid.tsx";
import { hasIssueWithoutVisibleField, issuesAfterEdit } from "./render-edit-logic.ts";
import {
  FOOTER_WRITE_FORM_DIRTY_KEY,
  footerSubmitActionIds,
  useReportWriteFormDirty,
  useWriteFormRegistry,
} from "./write-form-registry.ts";

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
  readonly section: EditWriteFormSectionViewModel & Pick<EditSectionViewModel, "titleOnNarrow">;
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
  registryKeys: readonly string[],
  controller: FormController,
  fields: readonly EditFieldViewModel[],
): void {
  const registry = useWriteFormRegistry();
  useEffect(() => {
    if (registryKeys.length === 0 || registry === null) return;
    const handle = {
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
    };
    for (const key of registryKeys) registry.set(key, handle);
    return () => {
      for (const key of registryKeys) registry.delete(key);
    };
  }, [registry, registryKeys, controller, fields]);
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
  const { GridCell, Button, StatusBadge, FillContainer } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;

  const initial = useMemo(
    () => Object.fromEntries(section.fields.map((f: EditFieldViewModel) => [f.field, f.value])),
    [section.fields],
  );
  const schema = useMemo(() => buildWriteFormSchema(section.fields), [section.fields]);
  const { controller, snapshot } = useForm({
    initial,
    ...(section.handler !== undefined && {
      submit: { type: section.handler, payloadMode: "values" as const },
    }),
    schema,
  });
  const isFooter = section.placement === "footer";
  useUnsavedInputSource(() => controller.getSnapshot().isDirty, { outlivesTabSwitch: isFooter });
  const insideDrawer = useInsideDrawer();
  const gutter = insideDrawer ? "px-6 max-sm:px-4" : "px-4";
  const { submitWith } = section;
  useReportWriteFormDirty(snapshot.isDirty, isFooter ? FOOTER_WRITE_FORM_DIRTY_KEY : submitWith);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<ErrorNotice | null>(null);
  const registryKeys = useMemo(
    () =>
      isFooter
        ? footerSubmitActionIds(section.actions)
        : submitWith === undefined
          ? []
          : [submitWith],
    [isFooter, submitWith, section.actions],
  );
  useRegisterWriteForm(registryKeys, controller, section.fields);

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
  const sectionTestId = `write-form-${section.title ?? section.handler ?? "footer"}`;
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
      <FieldsFrame isFooter={isFooter} columns={section.columns}>
        {section.fields.map((field: EditFieldViewModel) => (
          <FieldFrame key={field.field} isFooter={isFooter} field={field}>
            <GridCellForField
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
              {...appendixCellProps(
                {},
                field,
                { ...recordValues, ...snapshot.values },
                StatusBadge,
              )}
              allIssues={snapshot.errors}
              valueDisplay="form"
              row={snapshot.values}
              {...(hideTitle !== true &&
                section.title !== undefined && { sectionTitle: section.title })}
            />
          </FieldFrame>
        ))}
      </FieldsFrame>
      <WriteFormFeedback
        error={error}
        submitRow={
          onFooterAction === undefined && submitWith === undefined && !isFooter
            ? submitButton
            : null
        }
      />
    </>
  );

  if (isFooter) {
    return (
      <FillContainer
        {...(!insideDrawer && { className: "sticky bottom-0 z-10 shrink-0 bg-background" })}
        testId="write-form-footer"
      >
        <FillContainer className={`gap-2 py-3 ${gutter}`}>{content}</FillContainer>
        {actions !== undefined && (
          <FillContainer
            className={`flex-row flex-wrap items-center justify-end gap-2 border-t py-3 ${gutter}`}
          >
            {actions}
          </FillContainer>
        )}
      </FillContainer>
    );
  }

  return (
    <WriteFormSectionFrame
      section={section}
      hideTitle={hideTitle}
      labelTitle={labelTitle}
      actions={actions}
      testId={sectionTestId}
    >
      {content}
    </WriteFormSectionFrame>
  );
}

function FieldsFrame({
  isFooter,
  columns,
  children,
}: {
  readonly isFooter: boolean;
  readonly columns: number;
  readonly children: ReactNode;
}): ReactNode {
  const { Grid, FillContainer } = usePrimitives();
  if (!isFooter) return <Grid columns={columns}>{children}</Grid>;
  return <FillContainer className="gap-4 sm:flex-row sm:items-start">{children}</FillContainer>;
}

// In the footer a file field keeps a fixed column and the other fields share the rest.
function FieldFrame({
  isFooter,
  field,
  children,
}: {
  readonly isFooter: boolean;
  readonly field: EditFieldViewModel;
  readonly children: ReactNode;
}): ReactNode {
  const { FillContainer } = usePrimitives();
  if (!isFooter) return children;
  const holdsFile = field.type === "file" || field.type === "image";
  return (
    <FillContainer
      className={`min-w-0 ${holdsFile ? "sm:w-[260px] sm:shrink-0" : "sm:flex-1"}`}
      testId={`write-form-footer-field-${field.field}`}
    >
      <NarrowFileInputProvider value={true}>{children}</NarrowFileInputProvider>
    </FillContainer>
  );
}

function WriteFormSectionFrame({
  section,
  hideTitle,
  labelTitle,
  actions,
  testId,
  children,
}: {
  readonly section: WriteFormSectionProps["section"];
  readonly hideTitle: boolean | undefined;
  readonly labelTitle: boolean | undefined;
  readonly actions: ReactNode;
  readonly testId: string;
  readonly children: ReactNode;
}): ReactNode {
  const { Section, Card } = usePrimitives();

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
        testId={testId}
      >
        {children}
      </Card>
    );
  }

  return (
    <Section
      {...(section.title !== undefined && { title: section.title })}
      {...(section.titleOnNarrow === false && { titleOnNarrow: false as const })}
      {...(labelTitle === true && { titleStyle: "label" as const })}
      {...(section.description !== undefined && {
        subtitle: narrowAwareDescription(section.description, section.descriptionNarrow),
      })}
      {...(section.icon !== undefined && { icon: section.icon })}
      {...(actions !== undefined && { actions })}
      testId={testId}
    >
      {children}
    </Section>
  );
}
