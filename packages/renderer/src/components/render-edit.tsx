import type { EntityDefinition, EntityEditScreenDefinition } from "@kumiko/framework/ui-types";
import { normalizeEditField } from "@kumiko/framework/ui-types";
import type {
  DispatcherError,
  EditFieldViewModel,
  FieldConditions,
  FieldIssue,
  FormSnapshot,
  FormValues,
  SubmitResult,
  Translate,
} from "@kumiko/headless";
import { computeEditViewModel } from "@kumiko/headless";
import { type ReactNode, useMemo, useState } from "react";
import type { z } from "zod";
import { useForm } from "../hooks/use-form";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import { RenderField } from "./render-field";

// End-to-end renderer für einen entityEdit screen. Rendert aus-
// schließlich über Primitives — kein raw HTML. Ein Native-Renderer
// der dieselbe Primitives-Registry füllt kriegt das Form ohne weitere
// Änderungen.

export type RenderEditProps<TValues extends FormValues, TCtx = unknown> = {
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly featureName: string;
  readonly initial: TValues;
  readonly writeCommand: string;
  readonly translate?: Translate;
  readonly ctx?: TCtx;
  readonly schema?: z.ZodType;
  readonly onSubmit?: (result: SubmitResult<unknown>) => void;
  readonly payloadMode?: "values" | "changes";
  readonly buildPayload?: (snapshot: FormSnapshot<TValues>) => unknown;
  readonly onDelete?: () => Promise<void> | void;
  readonly onCancel?: () => void;
  readonly onReload?: () => void;
  /** i18n-key für den Submit-Button. Default: "kumiko.actions.save".
   *  Action-Forms (Tier 2.7d) übergeben hier ihren screen.submitLabel,
   *  damit "Speichern" durch domain-spezifischere Strings ersetzt
   *  werden kann ("Genehmigen" / "Versenden" / etc.). */
  readonly submitLabel?: string;
};

function deriveFormFields<TValues extends FormValues, TCtx>(
  screen: EntityEditScreenDefinition,
): Record<string, FieldConditions<TValues, TCtx>> {
  const out: Record<string, FieldConditions<TValues, TCtx>> = {};
  for (const section of screen.layout.sections) {
    for (const spec of section.fields) {
      const normalized = normalizeEditField(spec);
      out[normalized.field] = {
        ...(normalized.visible !== undefined && {
          visible: normalized.visible as FieldConditions<TValues, TCtx>["visible"],
        }),
        ...(normalized.readOnly !== undefined && {
          readonly: normalized.readOnly as FieldConditions<TValues, TCtx>["readonly"],
        }),
        ...(normalized.required !== undefined && {
          required: normalized.required as FieldConditions<TValues, TCtx>["required"],
        }),
      };
    }
  }
  return out;
}

export function RenderEdit<TValues extends FormValues, TCtx = unknown>(
  props: RenderEditProps<TValues, TCtx>,
): ReactNode {
  const {
    screen,
    entity,
    featureName,
    initial,
    writeCommand,
    translate: translateProp,
    ctx,
    schema,
    onSubmit,
    payloadMode = "values",
    buildPayload,
    onDelete,
    onCancel,
    onReload,
    submitLabel,
  } = props;
  // Translate-Fallback: wenn der Caller keine Translate-Fn übergibt,
  // konsumieren wir den i18next-Context direkt. Sonst wären Field-
  // Labels ohne Caller-Wiring raw-Keys (`feature:entity:foo:field:title`).
  // useTranslation throwt ohne LocaleProvider — das ist ok, weil RenderEdit
  // ohnehin nur in einem mounted Kumiko-App-Tree läuft.
  const t = useTranslation();
  const translate = translateProp ?? t;

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<DispatcherError | null>(null);
  const { Button, Banner, Dialog, Form, Section, Grid, GridCell, Text } = usePrimitives();

  const fields = useMemo(() => deriveFormFields<TValues, TCtx>(screen), [screen]);

  const { controller, snapshot } = useForm<TValues, TCtx>({
    initial,
    fields,
    ...(schema !== undefined && { schema }),
    ...(ctx !== undefined && { ctx }),
    submit: {
      type: writeCommand,
      payloadMode,
      ...(buildPayload !== undefined && { buildPayload }),
    },
  });

  const vm = useMemo(
    () =>
      computeEditViewModel({
        screen,
        entity,
        values: snapshot.values,
        translate,
        featureName,
        ctx,
      }),
    [screen, entity, snapshot.values, translate, featureName, ctx],
  );

  async function handleSubmit(): Promise<void> {
    setIsSubmitting(true);
    try {
      const result = await controller.submit();
      // Form-level Errors (ohne field-level details) landen im Banner.
      // Field-Errors fließen über snapshot.errors in die einzelnen Fields.
      if (result.isSuccess) {
        setFormError(null);
      } else if (!result.validationBlocked) {
        const fieldIssues = result.error.details?.fields ?? [];
        setFormError(fieldIssues.length === 0 ? result.error : null);
      }
      onSubmit?.(result);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Sticky-top Action-Bar: Save (+ optional Cancel) wandern in den
  // `actions`-Slot der Form-Primitive. Bei langen Forms bleibt der
  // Save-Button beim Scrollen erreichbar. Delete (destructive) bleibt
  // bewusst am Boden — andere Konzeptklasse als die primäre Action.
  const formActions = (
    <>
      {onCancel !== undefined && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => onCancel()}
          testId="render-edit-cancel"
        >
          {translate("kumiko.actions.cancel")}
        </Button>
      )}
      <Button
        type="submit"
        disabled={snapshot.isUnchanged || isSubmitting}
        loading={isSubmitting}
        variant="primary"
        testId="render-edit-submit"
      >
        {translate(submitLabel ?? "kumiko.actions.save")}
      </Button>
    </>
  );

  // Title-Resolution analog zu RenderList: i18n-Key `screen:<id>.title`,
  // mit screenId als Fallback wenn das Bundle den Key nicht kennt.
  const titleKey = `screen:${screen.id}.title`;
  const resolvedTitle = translate(titleKey);
  const formTitle = resolvedTitle === titleKey ? screen.id : resolvedTitle;

  return (
    <Form
      onSubmit={() => void handleSubmit()}
      title={formTitle}
      actions={formActions}
      testId="render-edit-form"
    >
      {vm.sections.map((section) => (
        <Section key={section.title} title={section.title} testId={`section-${section.title}`}>
          <Grid columns={section.columns}>
            {section.fields.map((field) => (
              <GridCellForField
                key={field.field}
                field={field}
                columns={section.columns}
                issues={snapshot.errors[field.field]}
                onChange={(v) => {
                  (controller.setField as (k: string, v: unknown) => void)(field.field, v);
                }}
                GridCell={GridCell}
              />
            ))}
          </Grid>
        </Section>
      ))}
      {formError !== null && (
        <Banner
          variant="error"
          testId="render-edit-form-error"
          actions={
            formError.code === "version_conflict" && onReload !== undefined ? (
              <Button
                variant="secondary"
                onClick={() => {
                  onReload();
                  setFormError(null);
                }}
                testId="render-edit-form-error-reload"
              >
                {translate("kumiko.actions.reload")}
              </Button>
            ) : undefined
          }
        >
          <Text testId="render-edit-form-error-key">{translate(formError.i18nKey)}</Text>
        </Banner>
      )}
      {onDelete !== undefined && (
        <>
          <Button
            type="button"
            variant="danger"
            testId="render-edit-delete"
            onClick={() => setConfirmDeleteOpen(true)}
          >
            {translate("kumiko.actions.delete")}
          </Button>
          <Dialog
            open={confirmDeleteOpen}
            onOpenChange={setConfirmDeleteOpen}
            title={translate("kumiko.actions.delete-confirm")}
            confirmLabel={translate("kumiko.actions.delete")}
            variant="danger"
            onConfirm={async () => {
              await onDelete();
            }}
            testId="render-edit-delete-dialog"
          />
        </>
      )}
    </Form>
  );
}

// Winziger Wrapper der die span-Logik kapselt und die Field-Cell in
// die Grid platziert. Eigene Component damit die map-Callback oben
// schlank bleibt.
type GridCellForFieldProps = {
  readonly field: EditFieldViewModel;
  readonly columns: number;
  readonly issues: readonly FieldIssue[] | undefined;
  readonly onChange: (value: unknown) => void;
  readonly GridCell: ReturnType<typeof usePrimitives>["GridCell"];
};

function GridCellForField({
  field,
  columns,
  issues,
  onChange,
  GridCell,
}: GridCellForFieldProps): ReactNode {
  const effectiveSpan = field.span !== undefined ? Math.min(field.span, columns) : 1;
  return (
    <GridCell span={effectiveSpan}>
      <RenderField field={field} {...(issues !== undefined && { issues })} onChange={onChange} />
    </GridCell>
  );
}
