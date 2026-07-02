import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  FieldCondition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  evalFieldCondition,
  isExtensionEditSection,
  normalizeEditField,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type {
  DispatcherError,
  EditExtensionSectionViewModel,
  EditFieldViewModel,
  EditSectionViewModel,
  FieldConditions,
  FieldIssue,
  FormSnapshot,
  FormValues,
  SubmitResult,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import { computeEditViewModel } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useMemo, useState } from "react";
import type { z } from "zod";
import { ExtensionFormRegistryProvider, useExtensionFormHost } from "../app/extension-form-submit";
import { extensionSectionName, useExtensionSectionComponent } from "../app/extension-sections";
import { useForm } from "../hooks/use-form";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import {
  hasEditableSection,
  resolveExtensionEntityId,
  shouldNotifyCaller,
} from "./render-edit-logic";
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
  /** Echte entity-id für extension-section-Mounts (Set-Value-UI). Mount UND
   *  persistExtensions lösen sie über `resolveExtensionEntityId(entityIdProp,
   *  vm.id)` auf — denselben Wert, damit die Section nicht editierbar gegen eine
   *  id mountet während Persist gegen eine andere (oder gar nicht) schreibt.
   *  Weglassen (undefined) = Fallback auf `vm.id` (= values["id"]), das das
   *  Update-Form für die bestehende Row trägt. Explizites `null` = "keine
   *  entity" (create-mode / keine extension-Persistenz). */
  readonly entityId?: string | null;
  /** Bereits gespeicherte Extension-Werte (z.B. `record.customFields`) für
   *  extension-section-Mounts. Erlaubt der Section, den Bestand beim Edit
   *  anzuzeigen. Nur der Update-Body liefert das. */
  readonly extensionInitialValues?: Readonly<Record<string, unknown>>;
  /** Standard single-write Submit-Pfad. Ignoriert wenn `customSubmit`
   *  gesetzt ist (configEdit-Screens dispatchen mehrere Writes pro
   *  Submit, da macht writeCommand keinen Sinn). */
  readonly writeCommand?: string;
  /** Override für die Submit-Pipeline. Wenn gesetzt, läuft erst
   *  controller.validate() und dann customSubmit(snapshot) statt
   *  controller.submit(). On-success rebased der Form-State so dass
   *  isUnchanged/isDirty wieder false werden — ohne das blieben
   *  Save-Button und Banner stale. */
  readonly customSubmit?: (snapshot: FormSnapshot<TValues>) => Promise<SubmitResult<unknown>>;
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
  /** Pro-Field-Zusatz-Inhalt inline nach dem Label (z.B. ConfigSourceBadge).
   *  Wird mit dem Field-Namen aufgerufen, returnt ReactNode oder
   *  undefined. */
  readonly labelAppendix?: (fieldName: string) => ReactNode | undefined;
  /** Pro-Field-Zusatz-Inhalt unter dem Input (z.B. ConfigCascadeView).
   *  Wird mit dem Field-Namen aufgerufen, returnt ReactNode oder
   *  undefined. */
  readonly fieldAppendix?: (fieldName: string) => ReactNode | undefined;
};

function toConditionValue<TValues extends FormValues, TCtx>(
  cond: FieldCondition,
): NonNullable<FieldConditions<TValues, TCtx>["visible"]> {
  if (typeof cond === "boolean") return cond;
  // @cast-boundary form-values: TValues ist strukturell ein Record.
  return (values: TValues) => evalFieldCondition(cond, values as Record<string, unknown>);
}

function deriveFormFields<TValues extends FormValues, TCtx>(
  screen: EntityEditScreenDefinition,
): Record<string, FieldConditions<TValues, TCtx>> {
  const out: Record<string, FieldConditions<TValues, TCtx>> = {};
  for (const section of screen.layout.sections) {
    if (isExtensionEditSection(section)) continue;
    for (const spec of section.fields) {
      const normalized = normalizeEditField(spec);
      out[normalized.field] = {
        ...(normalized.visible !== undefined && {
          visible: toConditionValue<TValues, TCtx>(normalized.visible),
        }),
        ...(normalized.readOnly !== undefined && {
          readonly: toConditionValue<TValues, TCtx>(normalized.readOnly),
        }),
        ...(normalized.required !== undefined && {
          required: toConditionValue<TValues, TCtx>(normalized.required),
        }),
      };
    }
  }
  return out;
}

// Resolves an extension-section's `{ react: { __component: "X" } }` marker
// to a registered React component via ExtensionSectionsProvider (filled in
// createKumikoApp from clientFeatures.extensionSectionComponents) and
// mounts it with the host entity name + id. Hook lives in its own
// component so we don't call `use*` inside vm.sections.map (rules-of-
// hooks would punish reordering sections between renders).
function ExtensionSectionMount({
  section,
  entityName,
  entityId,
  initialValues,
}: {
  readonly section: EditExtensionSectionViewModel;
  readonly entityName: string;
  readonly entityId: string | null;
  readonly initialValues?: Readonly<Record<string, unknown>>;
}): ReactNode {
  const { Banner, Section, Text } = usePrimitives();
  const name = extensionSectionName(section.component);
  const Component = useExtensionSectionComponent(name);
  if (Component === undefined) {
    return (
      <Section
        key={section.title}
        title={section.title}
        testId={`section-extension-${section.title}`}
      >
        <Banner variant="info" testId={`section-extension-placeholder-${section.title}`}>
          <Text>
            Extension section component{" "}
            <Text variant="code">{name ?? "(no __component name)"}</Text> not registered in
            clientFeatures.extensionSectionComponents.
          </Text>
        </Banner>
      </Section>
    );
  }
  return (
    <Section title={section.title} testId={`section-extension-${section.title}`}>
      <Component entityName={entityName} entityId={entityId} initialValues={initialValues} />
    </Section>
  );
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
    labelAppendix,
    fieldAppendix,
    entityId: entityIdProp,
    extensionInitialValues,
  } = props;
  const { customSubmit } = props;
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
  // Composed-Save: Extension-Sections melden hier ihren dirty-State (damit der
  // Save-Button aktiv wird wenn NUR eine Section geändert wurde) + ihren
  // Submit-Handler (läuft nach dem Entity-Write). extensionErrorKey hält den
  // i18n-Key einer fehlgeschlagenen Section-Persistierung.
  const [extensionDirty, setExtensionDirty] = useState(false);
  const [extensionErrorKey, setExtensionErrorKey] = useState<string | null>(null);
  const { registry: extensionFormRegistry, runAll: runExtensionSubmits } =
    useExtensionFormHost(setExtensionDirty);
  const { Button, Banner, Dialog, Form, Section, Grid, GridCell, Text } = usePrimitives();

  const fields = useMemo(() => deriveFormFields<TValues, TCtx>(screen), [screen]);

  // Submit-Config nur wenn der Caller einen writeCommand mitgibt; bei
  // customSubmit-Pfad kommt der Form-Controller ohne Submit-Wiring,
  // weil wir controller.submit() eh nicht rufen.
  const submitConfig =
    writeCommand !== undefined
      ? {
          type: writeCommand,
          payloadMode,
          ...(buildPayload !== undefined && { buildPayload }),
        }
      : undefined;

  const { controller, snapshot } = useForm<TValues, TCtx>({
    initial,
    fields,
    ...(schema !== undefined && { schema }),
    ...(ctx !== undefined && { ctx }),
    ...(submitConfig !== undefined && { submit: submitConfig }),
  });

  const vm = useMemo(
    () =>
      computeEditViewModel({
        screen,
        entity,
        values: snapshot.values,
        translate,
        featureName,
      }),
    [screen, entity, snapshot.values, translate, featureName],
  );

  // isFormEditable, not "hasEditableField" (653/2) — true for an extension
  // section with no fields of its own too (it carries its own dirty/save).
  const isFormEditable = hasEditableSection(vm.sections);

  // Persistiert alle composed Extension-Sections mit der aufgelösten entityId.
  // false = eine Section schlug fehl (ihr i18n-Key landet im Banner). Ohne
  // Entity-Kontext (create-mode ohne route-id) gibt es nichts zu schreiben.
  async function persistExtensions(): Promise<boolean> {
    const entityId = resolveExtensionEntityId(entityIdProp, vm.id);
    if (entityId === null) return true;
    const results = await runExtensionSubmits({ entityId });
    const failed = results.find((r) => !r.isSuccess);
    if (failed !== undefined) {
      setExtensionErrorKey(failed.errorKey ?? "kumiko.form.extension.save-failed");
      return false;
    }
    return true;
  }

  async function handleSubmit(): Promise<void> {
    setIsSubmitting(true);
    setExtensionErrorKey(null);
    try {
      // Extension-only: nur eine Section ist dirty, das Haupt-Form unverändert.
      // Kein Entity-Write (würde einen leeren changes-Payload schreiben) — nur
      // die Section-Handler laufen lassen.
      if (snapshot.isUnchanged && extensionDirty) {
        await persistExtensions();
        return;
      }
      let result: SubmitResult<unknown>;
      if (customSubmit !== undefined) {
        // customSubmit-Pfad (z.B. configEdit, das pro Field einen
        // separaten Write feuert). Erst client-side Validation, dann
        // an den Caller; on-success rebased der Form-State explizit
        // weil controller.submit() das normalerweise selbst macht und
        // ohne customSubmit's Hilfe weiß der Controller nichts vom
        // erfolgreichen Submit (isUnchanged blieb sonst false).
        //
        // WICHTIG: snapshot direkt vom Controller holen statt aus
        // React-State. Bei rapid fill→click kann React-Batching die
        // Input-State-Updates noch nicht commited haben, wenn der
        // submit-Click fire'd. handleSubmit's Closure würde dann mit
        // stale snapshot.changes={} laufen, customSubmit fired keine
        // Writes, returnt success, Form rebase → User glaubt "saved"
        // aber gar nichts ist passiert. controller.getSnapshot() ist
        // immer aktuell — der Controller ist die Source-of-Truth, die
        // React-State ist nur ein Mirror für's Rendering.
        const valid = controller.validate();
        if (!valid) {
          // Field-Order matters: validationBlocked-true ist eine eigene
          // Variante in der SubmitResult-Union (NICHT mit data/error
          // gemixt), TS narrowt das nur ohne den Discriminator-Fight.
          const blocked: SubmitResult<unknown> = {
            validationBlocked: true,
            isSuccess: false,
          };
          result = blocked;
        } else {
          result = await customSubmit(controller.getSnapshot());
          if (result.isSuccess) controller.rebase();
        }
      } else {
        result = await controller.submit();
      }
      // Form-level Errors (ohne field-level details) landen im Banner.
      // Field-Errors fließen über snapshot.errors in die einzelnen Fields.
      let extensionsPersisted = true;
      if (result.isSuccess) {
        setFormError(null);
        extensionsPersisted = await persistExtensions();
      } else if (!result.validationBlocked) {
        const fieldIssues = result.error.details?.fields ?? [];
        setFormError(fieldIssues.length === 0 ? result.error : null);
      }
      // skip: on entity-success-but-extension-failure the extension-error
      // banner is showing — don't notify (the caller navigates away on success
      // and would unmount it before the user sees the failure).
      if (shouldNotifyCaller(result, extensionsPersisted)) onSubmit?.(result);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Sticky-top Action-Bar: Delete (links, destructive) + Cancel +
  // Save. Delete sitzt links abgesetzt damit die Click-Distanz zu
  // Save groß ist; rot + Confirm-Dialog sind ausreichend Schutz
  // gegen Fehlklicks. Save bleibt rechts (primary affordance).
  const formActions = (
    <>
      {onDelete !== undefined && (
        <Button
          type="button"
          variant="danger"
          testId="render-edit-delete"
          onClick={() => setConfirmDeleteOpen(true)}
        >
          {translate("kumiko.actions.delete")}
        </Button>
      )}
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
      {isFormEditable && (
        <Button
          type="submit"
          disabled={(snapshot.isUnchanged && !extensionDirty) || isSubmitting}
          loading={isSubmitting}
          variant="primary"
          testId="render-edit-submit"
        >
          {translate(submitLabel ?? "kumiko.actions.save")}
        </Button>
      )}
    </>
  );

  // Title + Subtitle, create/edit-bewusst. i18n-Keys (mode = "create"|"edit"):
  //   screen:<id>.<mode>.title / .<mode>.subtitle
  // Fallback-Kette: mode-spezifisch → generisch (screen:<id>.title/.subtitle).
  // title fällt zuletzt auf screenId, subtitle auf undefined (kein Untertitel).
  const isCreate = (() => {
    const id = resolveExtensionEntityId(entityIdProp, vm.id);
    return id == null || id === "";
  })();
  const formMode = isCreate ? "create" : "edit";
  const resolveScreenText = (suffix: string): string | undefined => {
    for (const key of [
      `screen:${screen.id}.${formMode}.${suffix}`,
      `screen:${screen.id}.${suffix}`,
    ]) {
      const value = translate(key);
      if (value !== key) return value;
    }
    return undefined;
  };
  const formTitle = resolveScreenText("title") ?? screen.id;
  const formSubtitle = resolveScreenText("subtitle");

  return (
    <ExtensionFormRegistryProvider value={extensionFormRegistry}>
      <Form
        onSubmit={() => void handleSubmit()}
        title={formTitle}
        {...(formSubtitle !== undefined && { subtitle: formSubtitle })}
        actions={formActions}
        testId="render-edit-form"
      >
        {vm.sections.map((section: EditSectionViewModel, sectionIndex: number) => {
          if (section.kind === "extension") {
            return (
              <ExtensionSectionMount
                key={section.title}
                section={section}
                entityName={vm.entityName}
                entityId={resolveExtensionEntityId(entityIdProp, vm.id)}
                initialValues={extensionInitialValues}
              />
            );
          }
          // Section-Header unterdrücken wenn er den Form-Titel der
          // Action-Bar 1:1 wiederholen würde (typisch bei Single-Section-
          // ActionForms, deren Section-Label = Screen-Titel ist).
          const sectionTitle = section.title === formTitle ? undefined : section.title;
          // Titellose Sections kollidieren sonst auf key/testId — Index-Fallback.
          const sectionKey = section.title ?? `section-${sectionIndex}`;
          return (
            <Section
              key={sectionKey}
              {...(sectionTitle !== undefined && { title: sectionTitle })}
              testId={`section-${sectionKey}`}
            >
              <Grid columns={section.columns}>
                {section.fields.map((field: EditFieldViewModel) => (
                  <GridCellForField
                    key={field.field}
                    field={field}
                    columns={section.columns}
                    issues={snapshot.errors[field.field]}
                    onChange={(v) => {
                      (controller.setField as (k: string, v: unknown) => void)(field.field, v);
                    }}
                    GridCell={GridCell}
                    featureName={featureName}
                    {...(labelAppendix !== undefined && {
                      labelAppendix: labelAppendix(field.field),
                    })}
                    {...(fieldAppendix !== undefined && {
                      fieldAppendix: fieldAppendix(field.field),
                    })}
                  />
                ))}
              </Grid>
            </Section>
          );
        })}
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
        {extensionErrorKey !== null && (
          <Banner variant="error" testId="render-edit-extension-error">
            <Text testId="render-edit-extension-error-key">{translate(extensionErrorKey)}</Text>
          </Banner>
        )}
        {onDelete !== undefined && (
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
        )}
      </Form>
    </ExtensionFormRegistryProvider>
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
  /** Tier 2.7e-3: durchgereicht damit Reference-Felder die richtige
   *  Lookup-Query-QN bauen können (`<feature>:query:<refEntity>:list`). */
  readonly featureName: string;
  readonly labelAppendix?: ReactNode;
  readonly fieldAppendix?: ReactNode;
};

function GridCellForField({
  field,
  columns,
  issues,
  onChange,
  GridCell,
  featureName,
  labelAppendix,
  fieldAppendix,
}: GridCellForFieldProps): ReactNode {
  const effectiveSpan = field.span !== undefined ? Math.min(field.span, columns) : 1;
  return (
    <GridCell span={effectiveSpan}>
      <RenderField
        field={field}
        {...(issues !== undefined && { issues })}
        onChange={onChange}
        featureName={featureName}
        {...(labelAppendix !== undefined && { labelAppendix })}
        {...(fieldAppendix !== undefined && { fieldAppendix })}
      />
    </GridCell>
  );
}
