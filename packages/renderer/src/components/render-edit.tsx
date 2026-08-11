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
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { ExtensionFormRegistryProvider, useExtensionFormHost } from "../app/extension-form-submit";
import { extensionSectionName, useExtensionSectionComponent } from "../app/extension-sections";
import { useDispatcher } from "../context/dispatcher-context";
import { useForm } from "../hooks/use-form";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import {
  filterEditSections,
  hasEditableSection,
  resolveExtensionEntityId,
  shouldNotifyCaller,
} from "./render-edit-logic";
import { RenderField } from "./render-field";

// Qualified names of the bundled `form-draft` feature. Hardcoded because the
// renderer must not depend on @cosmicdrift/kumiko-bundled-features; a screen
// with `layout.draft: true` and that feature unmounted is a boot error, so
// these can never dangle silently.
const FORM_DRAFT_GET = "form-draft:query:get";
const FORM_DRAFT_SAVE = "form-draft:write:save";
const FORM_DRAFT_DISCARD = "form-draft:write:discard";

type FormDraftBlob = {
  readonly values: Record<string, unknown>;
  readonly stepIndex: number;
};

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
  /** Copy-Link-Action (Issue #912) — nur in update-mode gesetzt (create-mode
   *  hat noch keine entity-id, also keinen Permalink). Der Callback ist
   *  bereits vollständig gebunden (URL-Bau + Clipboard passiert außerhalb,
   *  in `@cosmicdrift/kumiko-renderer-web`'s RoutedScreen — dieses
   *  platform-neutrale Package darf kein `navigator`/`window` anfassen,
   *  siehe guard-renderer-boundaries). undefined = kein Button. */
  readonly onCopyLink?: () => Promise<void> | void;
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
  /** Controlled mode (issue #1887): fires on every values-snapshot change
   *  (typing, `patch(...)` from outside) with the current values. `changes`
   *  is the delta against the initial values — same semantics as
   *  `payloadMode: "changes"` — so a caller never overwrites unseen fields.
   *  `valid` is a pure dry-run parse against `schema` (not a
   *  `controller.validate()` call), so it does not paint field errors into
   *  the UI and can diverge from the currently rendered `snapshot.errors` —
   *  always `true` without `schema`. A caller that patches a fresh object
   *  reference on every call must not do so unconditionally: `setValues` is
   *  a no-op when the merged value is reference-equal to the current one,
   *  so only a converging patch settles instead of looping. Without this
   *  prop, existing behavior is unchanged. */
  readonly onChange?: (state: RenderEditChangeState<TValues>) => void;
  /** Controlled mode (issue #1887): called once after mount, hands the
   *  caller `patch`/`validate`/`getValues` bound to this RenderEdit
   *  instance — addressable from outside without a remount. `patch` merges
   *  only the given keys (existing `controller.setValues` semantics),
   *  values on unmentioned fields stay untouched. `validate` runs without a
   *  write and reports field issues via `snapshot.errors` on the field
   *  itself rather than as a summary banner. Without this prop, existing
   *  behavior is unchanged. */
  readonly onControlsReady?: (controls: RenderEditControls<TValues>) => void;
  /** Renders only these fields (by `field` name from the layout) — section
   *  order, title, and visibility still come from the layout, so the caller
   *  doesn't duplicate its shape. A section with no fields left after
   *  filtering is dropped entirely (not rendered empty). Submit validation
   *  is scoped to the actually-rendered fields the same way — a required
   *  field outside this list doesn't block submit. Omitting this prop keeps
   *  unchanged behavior. Read once at mount for `controller.submit()`'s
   *  validation scope (the underlying `useForm` controller is mount-lived);
   *  rendering and `controls.validate()` do stay reactive to later changes. */
  readonly fields?: readonly string[];
  /** Locked state (issue #1896): every rendered field and the submit button
   *  go visibly inactive, no write possible. For cases where input becomes
   *  moot — e.g. Solon's editor pointing at an existing record instead of
   *  creating a new one. Extension sections are out of scope: RenderEdit has
   *  no way to force-disable an arbitrary registered component. Omitting
   *  this prop keeps unchanged behavior. */
  readonly disabled?: boolean;
};

export type RenderEditChangeState<TValues extends FormValues> = {
  readonly values: TValues;
  readonly changes: Partial<TValues>;
  readonly dirty: boolean;
  readonly valid: boolean;
};

export type RenderEditControls<TValues extends FormValues> = {
  readonly patch: (partial: Partial<TValues>) => void;
  readonly validate: () => boolean;
  readonly getValues: () => TValues;
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
  values,
  patch,
  validate,
}: {
  readonly section: EditExtensionSectionViewModel;
  readonly entityName: string;
  readonly entityId: string | null;
  readonly initialValues?: Readonly<Record<string, unknown>>;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly patch?: (partial: Readonly<Record<string, unknown>>) => void;
  readonly validate?: () => boolean;
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
      <Component
        entityName={entityName}
        entityId={entityId}
        initialValues={initialValues}
        values={values}
        patch={patch}
        validate={validate}
      />
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
    onCopyLink,
    submitLabel,
    labelAppendix,
    fieldAppendix,
    entityId: entityIdProp,
    extensionInitialValues,
    onChange,
    onControlsReady,
    fields: fieldsFilter,
    disabled = false,
  } = props;
  const { customSubmit } = props;
  // Translate-Fallback: wenn der Caller keine Translate-Fn übergibt,
  // konsumieren wir den i18next-Context direkt. Sonst wären Field-
  // Labels ohne Caller-Wiring raw-Keys (`feature:entity:foo:field:title`).
  // useTranslation throwt ohne LocaleProvider — das ist ok, weil RenderEdit
  // ohnehin nur in einem mounted Kumiko-App-Tree läuft.
  const t = useTranslation();
  const translate = translateProp ?? t;
  const dispatcher = useDispatcher();

  const isWizard = screen.layout.mode === "wizard";
  const draftEnabled = isWizard && screen.layout.draft === true;
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<DispatcherError | null>(null);
  const [rawStep, setRawStep] = useState(0);
  // Composed-Save: Extension-Sections melden hier ihren dirty-State (damit der
  // Save-Button aktiv wird wenn NUR eine Section geändert wurde) + ihren
  // Submit-Handler (läuft nach dem Entity-Write). extensionErrorKey hält den
  // i18n-Key einer fehlgeschlagenen Section-Persistierung.
  const [extensionDirty, setExtensionDirty] = useState(false);
  const [extensionErrorKey, setExtensionErrorKey] = useState<string | null>(null);
  const { registry: extensionFormRegistry, runAll: runExtensionSubmits } =
    useExtensionFormHost(setExtensionDirty);
  const { Button, Banner, Dialog, Form, Section, Grid, GridCell, Text, Progress } = usePrimitives();

  const fields = useMemo(() => deriveFormFields<TValues, TCtx>(screen), [screen]);

  // Scope für validate()/submit() — nur die tatsächlich gerenderten Feldnamen
  // aus `fields` (bereits non-extension-only, siehe deriveFormFields), auf den
  // `fields`-Filter-Prop eingeschränkt. Muss VOR submitConfig/useForm stehen
  // (der Controller bakt submitConfig beim ersten Render dauerhaft ein) und
  // kann daher nicht von `vm`/`filteredSections` abgeleitet werden, die erst
  // nach dem Controller (aus snapshot.values) existieren — die Feldnamen-Menge
  // pro Section ist aber wertunabhängig (nur visible/readOnly/value hängen von
  // `values` ab), also liefert diese Ableitung dieselbe Menge wie
  // filterEditSections(vm.sections, fieldsFilter) es täte. undefined (= kein
  // Filter aktiv) heißt unscoped validate/submit — auf "alle gerenderten
  // Felder" scopen würde sonst root-level .refine()-Issues aus der
  // unscoped-Validierung stillschweigend wegfiltern.
  const scopeFieldNames = useMemo(
    () =>
      fieldsFilter === undefined ? undefined : fieldsFilter.filter((f) => Object.hasOwn(fields, f)),
    [fieldsFilter, fields],
  );

  // Submit-Config nur wenn der Caller einen writeCommand mitgibt; bei
  // customSubmit-Pfad kommt der Form-Controller ohne Submit-Wiring,
  // weil wir controller.submit() eh nicht rufen.
  const submitConfig =
    writeCommand !== undefined
      ? {
          type: writeCommand,
          payloadMode,
          ...(buildPayload !== undefined && { buildPayload }),
          ...(scopeFieldNames !== undefined && { validateScope: scopeFieldNames }),
        }
      : undefined;

  const { controller, snapshot } = useForm<TValues, TCtx>({
    initial,
    fields,
    ...(schema !== undefined && { schema }),
    ...(ctx !== undefined && { ctx }),
    ...(submitConfig !== undefined && { submit: submitConfig }),
  });

  // Derived from the screen id + the host entity id only — never from
  // `vm.id`, which lives in the form values a restore mutates (load under one
  // key, save under another).
  const draftKey = useMemo(
    () =>
      entityIdProp === undefined || entityIdProp === null || entityIdProp === ""
        ? screen.id
        : `${screen.id}:${entityIdProp}`,
    [screen.id, entityIdProp],
  );

  // Controlled mode (Issue #1887). Both callbacks live in refs so a
  // re-rendering caller (identity-unstable `onChange`/`onControlsReady`
  // closures, e.g. inline arrows) doesn't retrigger these effects — only a
  // real snapshot mutation (typing, patch()) does. Without this, a caller
  // whose onChange calls patch() to fill other fields (the VIN-decode use
  // case from #1888) would loop: patch → new snapshot → effect
  // re-subscribes with a "new" onChange → refires.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const cb = onChangeRef.current;
    if (cb === undefined) return;
    // Dry-run parse against `schema` — NOT controller.validate(). Calling
    // validate() here would write field-level errors into snapshot.errors
    // on every keystroke, painting error messages while the user is still
    // typing. `valid` can therefore legitimately diverge from what's
    // currently rendered under the fields (the last *mutating* validate()
    // call, e.g. from controls.validate() or submit()).
    const valid = schema === undefined ? true : schema.safeParse(snapshot.values).success;
    cb({ values: snapshot.values, changes: snapshot.changes, dirty: snapshot.isDirty, valid });
  }, [snapshot, schema]);

  const onControlsReadyRef = useRef(onControlsReady);
  onControlsReadyRef.current = onControlsReady;
  const scopeFieldNamesRef = useRef(scopeFieldNames);
  scopeFieldNamesRef.current = scopeFieldNames;
  const scopedValidate = useCallback(
    () => controller.validate(scopeFieldNamesRef.current),
    [controller],
  );
  useEffect(() => {
    const cb = onControlsReadyRef.current;
    if (cb === undefined) return;
    cb({
      patch: controller.setValues,
      validate: scopedValidate,
      getValues: () => controller.getSnapshot().values,
    });
    // controller is mount-lifetime-stable (see useForm's comment on its
    // own useMemo) — this fires exactly once per RenderEdit mount.
  }, [controller, scopedValidate]);

  useEffect(() => {
    // skip: this screen does not persist a draft.
    if (!draftEnabled) return;
    let cancelled = false;
    void (async () => {
      const result = await dispatcher.query<{ readonly draft: FormDraftBlob | null }>(
        FORM_DRAFT_GET,
        { draftKey },
      );
      // skip: superseded by a newer mount, or the draft lookup failed — an
      // unreachable draft store must not break the form itself.
      if (cancelled || !result.isSuccess) return;
      const draft = result.data?.draft ?? null;
      // skip: nothing saved yet for this key.
      if (draft === null) return;
      // skip: the user already typed while the lookup was in flight — their
      // input wins over the stored draft.
      if (controller.getSnapshot().isDirty) return;
      // @cast-boundary form-draft blob: `values` round-trips through an opaque
      // jsonb column and comes back untyped.
      controller.setValues(draft.values as Partial<TValues>);
      setRawStep(Math.max(draft.stepIndex, 0));
    })();
    return () => {
      cancelled = true;
    };
  }, [draftEnabled, draftKey, dispatcher, controller]);

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

  const filteredSections = useMemo(
    () => filterEditSections(vm.sections, fieldsFilter),
    [vm.sections, fieldsFilter],
  );

  // true for an extension section with no fields of its own too (it carries its own dirty/save).
  const isFormEditable = hasEditableSection(filteredSections);

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

  const lastStepIndex = Math.max(filteredSections.length - 1, 0);
  // Clamped on read, not on write: section visibility is value-dependent, so a
  // stored stepIndex can point past what is currently rendered — that lands on
  // the last step instead of an empty one.
  const currentStep = Math.min(rawStep, lastStepIndex);
  const isLastWizardStep = currentStep >= lastStepIndex;

  // Step transitions only — never per keystroke. Deliberately not awaited: a
  // failed draft save must not block the step change.
  function saveDraft(stepIndex: number): void {
    // skip: this screen does not persist a draft.
    if (!draftEnabled) return;
    void dispatcher.write(FORM_DRAFT_SAVE, {
      draftKey,
      values: controller.getSnapshot().values,
      stepIndex,
    });
  }

  // Next: scoped validate() on the current step's fields — errors stay
  // attached to the field and block the step transition. Extension steps
  // have no field scope here (they validate via the controlled-mode
  // controls.validate() API), so no call, no clearing of unrelated errors.
  function handleWizardNext(): void {
    const section = filteredSections[currentStep];
    const fieldNames = section?.kind === "fields" ? section.fields.map((f) => f.field) : [];
    // skip: the current step has field errors — no transition, no draft save.
    if (fieldNames.length > 0 && !controller.validate(fieldNames)) return;
    const next = Math.min(currentStep + 1, lastStepIndex);
    setRawStep(next);
    saveDraft(next);
  }

  function handleWizardBack(): void {
    const previous = Math.max(currentStep - 1, 0);
    setRawStep(previous);
    saveDraft(previous);
  }

  async function discardDraft(): Promise<void> {
    // skip: this screen does not persist a draft.
    if (!draftEnabled) return;
    await dispatcher.write(FORM_DRAFT_DISCARD, { draftKey });
  }

  async function handleSubmit(): Promise<void> {
    // Locked state (#1896): the submit button is visibly disabled, but a
    // native form submit (Enter key) reaches this handler regardless of the
    // button's disabled attribute — block it here too, not just in the UI.
    if (disabled) return;
    // Enter in the active step triggers the native form submit (Next is
    // type="submit" for Enter support) — on intermediate steps that means
    // "Next", not "Save".
    if (isWizard && !isLastWizardStep) {
      handleWizardNext();
      return;
    }
    setIsSubmitting(true);
    setExtensionErrorKey(null);
    try {
      // Extension-only: nur eine Section ist dirty, das Haupt-Form unverändert.
      // Kein Entity-Write (würde einen leeren changes-Payload schreiben) — nur
      // die Section-Handler laufen lassen.
      if (snapshot.isUnchanged && extensionDirty) {
        // Same discard as the main path: an extension-only save is still a
        // successful submit, so the draft must not survive it.
        if (await persistExtensions()) await discardDraft();
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
        const valid = controller.validate(scopeFieldNames);
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
        // Awaited, not fire-and-forget: `onSubmit` typically navigates away and
        // unmounts this form, which would abort an in-flight discard and leave
        // the draft behind after a successful submit.
        await discardDraft();
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
      {onCopyLink !== undefined && (
        <Button
          type="button"
          variant="secondary"
          testId="render-edit-copy-link"
          onClick={async () => {
            await onCopyLink();
            setLinkCopied(true);
          }}
        >
          {translate(linkCopied ? "kumiko.actions.copyLinkCopied" : "kumiko.actions.copyLink")}
        </Button>
      )}
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
      {isWizard && currentStep > 0 && (
        <Button
          type="button"
          variant="secondary"
          onClick={handleWizardBack}
          testId="render-edit-wizard-back"
        >
          {translate("kumiko.actions.back")}
        </Button>
      )}
      {isWizard && !isLastWizardStep && (
        <Button
          type="submit"
          disabled={disabled}
          variant="primary"
          testId="render-edit-wizard-next"
        >
          {translate("kumiko.actions.next")}
        </Button>
      )}
      {isFormEditable && (!isWizard || isLastWizardStep) && (
        <Button
          type="submit"
          disabled={(snapshot.isUnchanged && !extensionDirty) || isSubmitting || disabled}
          loading={isSubmitting}
          variant="primary"
          testId="render-edit-submit"
        >
          {translate(submitLabel ?? (isWizard ? "kumiko.actions.finish" : "kumiko.actions.save"))}
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
        {...(screen.layout.width !== undefined && { width: screen.layout.width })}
      >
        {isWizard && (
          <>
            {Progress !== undefined && (
              <Progress
                value={(currentStep + 1) / (lastStepIndex + 1)}
                testId="render-edit-wizard-progress"
              />
            )}
            <Text variant="small" testId="render-edit-wizard-step-label">
              {translate("kumiko.wizard.step", {
                current: currentStep + 1,
                total: lastStepIndex + 1,
              })}
            </Text>
          </>
        )}
        {(isWizard ? filteredSections.filter((_, i) => i === currentStep) : filteredSections).map(
          (section: EditSectionViewModel, sectionIndex: number) => {
            if (section.kind === "extension") {
              return (
                <ExtensionSectionMount
                  key={section.title}
                  section={section}
                  entityName={vm.entityName}
                  entityId={resolveExtensionEntityId(entityIdProp, vm.id)}
                  initialValues={extensionInitialValues}
                  values={snapshot.values}
                  // @cast-boundary form-values: ExtensionSectionProps is not generic
                  // over TValues; controller is mount-lifetime-stable, see onControlsReady above.
                  patch={
                    controller.setValues as (partial: Readonly<Record<string, unknown>>) => void
                  }
                  validate={scopedValidate}
                />
              );
            }
            if (!section.visible) return null;
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
                {...(section.description !== undefined && { subtitle: section.description })}
                testId={`section-${sectionKey}`}
              >
                <Grid columns={section.columns}>
                  {section.fields.map((field: EditFieldViewModel) => (
                    <GridCellForField
                      key={field.field}
                      field={disabled ? { ...field, readOnly: true } : field}
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
                      allIssues={snapshot.errors}
                    />
                  ))}
                </Grid>
              </Section>
            );
          },
        )}
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
  /** Full issues-by-path map (FormSnapshot.errors) — passed through for
   *  embedded-list fields, which bucket row-/cell-level issues themselves. */
  readonly allIssues: Readonly<Record<string, readonly FieldIssue[]>>;
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
  allIssues,
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
        allIssues={allIssues}
      />
    </GridCell>
  );
}
