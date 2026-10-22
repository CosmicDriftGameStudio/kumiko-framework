import { PROJECTION_DETAIL_ENTITY } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ErrorNotice, ErrorReference } from "../app/error-reference.tsx";
import {
  ExtensionFormRegistryProvider,
  useExtensionFormHost,
} from "../app/extension-form-submit.tsx";
import { extensionSectionName, useExtensionSectionComponent } from "../app/extension-sections.tsx";
import { layoutEditFields } from "../app/layout-fields.ts";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useDraftStorage } from "../context/draft-storage-context.tsx";
import { formatWhen } from "../format-when.ts";
import type {
  DispatcherError,
  EditFieldViewModel,
  EditSectionViewModel,
  FieldIssue,
  FormValues,
  SubmitResult,
} from "../headless/index.ts";
import { computeEditViewModel, groupIssuesByPath } from "../headless/index.ts";
import { useForm } from "../hooks/use-form.ts";
import { useTranslation } from "../i18n.tsx";
import { useInsideDrawer } from "../inside-drawer.ts";
import { useUnsavedInputSource } from "../leave-guard.ts";
import { usePageHeaderCompact, usePageHeaderSlotAvailable } from "../page-header-slot.ts";
import {
  type ActionMenuItemSpec,
  FOOTER_ACTION_ROLE_PROP,
  type FormSectionNavItem,
  NARROW_LABEL_PROP,
  STICKY_PRIMARY_ACTION_PROP,
  shouldRenderActionsIconOnly,
  usePrimitives,
} from "../primitives.tsx";
import { EditSlotMount, ExtensionSectionMount } from "./edit-mounts.tsx";
import { changedDerivedValues } from "./form-derivation-patch.ts";
import { GridCellForField } from "./grid-cell-for-field.tsx";
import { RelatedListSection } from "./related-list-section.tsx";
import { RenderEditActionButton } from "./render-edit-action-button.tsx";
import {
  deriveFormFields,
  dryRunFieldIssues,
  dryRunParse,
  type FormErrorSource,
  formSectionDomId,
  isFieldsStepFilled,
  resolveRecordTitle,
  resolveTitleTemplate,
  tabIdAt,
  wizardStepKey,
} from "./render-edit-helpers.tsx";
import {
  filterEditSections,
  findFirstErroringSectionIndex,
  hasEditableSection,
  hasIssueWithoutRenderedField,
  isDispatcherRejection,
  issuesAfterEdit,
  ROOT_ISSUE_PATH,
  resolveExtensionEntityId,
  shouldNotifyCaller,
} from "./render-edit-logic.ts";
import type { RenderEditProps } from "./render-edit-types.ts";
import { AllFieldsRequiredProvider } from "./render-field.tsx";
import { useActionMenuItems } from "./use-action-menu-items.tsx";
import {
  buildWizardDraftActions,
  PATCH_DRAFT_SAVE_DEBOUNCE_MS,
  useWizardFormDraftRestore,
  useWizardFormDraftState,
} from "./use-wizard-form-draft.ts";
import { WriteFormSection } from "./write-form-section.tsx";

export type {
  RenderEditAction,
  RenderEditChangeState,
  RenderEditControls,
  RenderEditProps,
} from "./render-edit-types.ts";

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
    serverFieldPathPrefix,
    onDelete,
    onCancel,
    onReload,
    refreshToken,
    onDirtyChange,
    onCopyLink,
    actions,
    menuActions,
    onRelatedListDrawerAction,
    submitLabel,
    submitVariant,
    submitWithoutChanges,
    footerActions,
    summary,
    labelAppendix,
    fieldAppendix,
    fieldAppendixPlacement,
    fieldDescription,
    fieldAccent,
    markChangedFields = false,
    entityId: entityIdProp,
    extensionInitialValues,
    onChange,
    onControlsReady,
    fields: fieldsFilter,
    disabled: disabledProp = false,
    viewMode = false,
    hideActions,
    valueDisplay = "form",
    hideSectionTitles,
    fillScreenHeight,
    dirtyFooter,
    validateOnChange,
    headerRegion,
    buildSectionActions,
    leadContent,
    submitBlocked = false,
    formDerivation,
    actionFormScreenQn,
  } = props;
  // View mode is a locked form, so everything keyed on `disabled` follows.
  const disabled = disabledProp || viewMode;
  const i18nScreenId = props.i18nScreenId ?? screen.id;
  const { customSubmit } = props;
  // Translate fallback: when the caller does not provide a translate function,
  // consume the i18next context directly. Otherwise field labels would remain raw
  // keys (`feature:entity:foo:field:title`) without caller wiring.
  // useTranslation throws without a LocaleProvider, which is acceptable because
  // RenderEdit only runs inside a mounted Kumiko app tree.
  const t = useTranslation();
  const translate = translateProp ?? t;
  const dispatcher = useOptionalDispatcher();

  const isWizard = screen.layout.mode === "wizard";
  // Tabs reuse the wizard's step machinery: one section visible at a time,
  // all of them mounted, `currentStep` as the active index. What they do NOT
  // share is navigation — a tab form submits from any tab, so every
  // step-transition path below stays wizard-only.
  const isTabs = screen.layout.mode === "tabs";
  const draftEnabled = isWizard && screen.layout.draft === true && dispatcher !== undefined;
  const isCreateMode = entityIdProp === undefined || entityIdProp === null || entityIdProp === "";
  const draftStorage = useDraftStorage();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusFirstErrorKey, setFocusFirstErrorKey] = useState(0);
  const [formError, setFormError] = useState<DispatcherError | null>(null);
  // Only a submit's validation/server error is cleared by editing; a delete
  // rejection and a version conflict (reload is the way out) stay put.
  const [formErrorSource, setFormErrorSource] = useState<FormErrorSource>("submit");
  // A rejected delete can carry several blocking reasons; the first one is the
  // banner's headline (formError), the rest are listed beneath it.
  const [extraDeleteIssues, setExtraDeleteIssues] = useState<readonly FieldIssue[]>([]);
  // One state for all header actions (actions?), not per-button — only one
  // action can be in flight at a time, and this keeps the error surfaced in
  // the shared formError-adjacent banner region instead of inside the
  // button row: a full-width Banner there breaks the
  // flex justify-end action bar.
  const [actionError, setActionError] = useState<ErrorNotice | null>(null);
  const [rawStep, setRawStep] = useState(0);
  const [passedStepKeys, setPassedStepKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [extensionStepComplete, setExtensionStepComplete] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const reportExtensionStepComplete = useCallback((stepKey: string, complete: boolean) => {
    setExtensionStepComplete((prev) =>
      (prev[stepKey] === true) === complete ? prev : { ...prev, [stepKey]: complete },
    );
  }, []);
  // Tabs have stable ids, so the active tab follows its id: a field change
  // that hides an earlier tab must not shift the index onto another tab.
  const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined);
  const draftState = useWizardFormDraftState({
    screenId: screen.id,
    entityId: entityIdProp,
    isCreateMode,
    draftStorage,
  });
  const { draftCandidates, setDraftCandidates } = draftState;
  // Composed save: extension sections report their dirty state so the Save button
  // activates when only a section changed, and provide a submit handler that runs
  // after the entity write. extensionErrorKey stores the i18n key for a failed
  // section persistence.
  //
  // This is not a second write path for saveDraft()'s data: deriveFormFields
  // skips extension sections entirely, so extension-owned field state never enters
  // `fields` or `controller.getSnapshot().values`; there is no draft-covered state
  // left for persistExtensions() to compete over.
  const [extensionDirty, setExtensionDirty] = useState(false);
  // Mirror for the leave guard: it must see "saved" before React re-renders.
  const extensionDirtyRef = useRef(false);
  const [hasExtensionRegistrations, setHasExtensionRegistrations] = useState(false);
  const [extensionErrorKey, setExtensionErrorKey] = useState<string | null>(null);
  const { registry: extensionFormRegistry, runAll: runExtensionSubmits } = useExtensionFormHost(
    ({ anyDirty, hasRegistrations }) => {
      extensionDirtyRef.current = anyDirty;
      setExtensionDirty(anyDirty);
      setHasExtensionRegistrations(hasRegistrations);
    },
  );
  const {
    Button,
    Banner,
    Card,
    Dialog,
    Form,
    Section,
    Grid,
    GridCell,
    Text,
    Progress,
    StepBar,
    WizardStepGroup,
    Tabs,
    PageHeader,
    ActionOverflowMenu,
  } = usePrimitives();
  const { toMenuItem: menuActionToItem, confirmDialog: menuActionConfirmDialog } =
    useActionMenuItems({ Dialog, onError: setActionError });
  const pageHeaderSlotAvailable = usePageHeaderSlotAvailable();
  const pageHeaderCompact = usePageHeaderCompact();
  const insideDrawer = useInsideDrawer();

  // Both stepped layouts show one section at a time and keep the rest mounted
  // but inert. A tabs layout on a host without the Tabs primitive has no strip
  // to switch with, so it falls back to rendering every section stacked rather
  // than stranding the user on section 0. Same fallback when the
  // WizardStepGroup wrapper is missing.
  const isStepped = isWizard || (isTabs && Tabs !== undefined && WizardStepGroup !== undefined);
  const fields = useMemo(() => deriveFormFields<TValues, TCtx>(screen), [screen]);

  // Must be computed before submitConfig/useForm bakes it in (the controller
  // freezes it on first render). This is the unfiltered field-name set from
  // `fieldsFilter` ∩ `fields` — not the value-dependent `filteredSections`
  // (which also drops `section.visible === false`). Hidden fields still fall
  // out via form-controller's `hiddenFields` path. undefined = unscoped, since
  // scoping would silently drop root-level .refine() issues.
  // A `fieldsFilter` that matches nothing in `fields` (typo, renamed field)
  // must fall back to unscoped too — an empty scope array would filter out
  // ALL validation issues, letting submit() through
  // unvalidated on a form that also renders no sections.
  const scopeFieldNames = useMemo(() => {
    if (fieldsFilter === undefined) return undefined;
    const matched = fieldsFilter.filter((f) => Object.hasOwn(fields, f));
    return matched.length === 0 ? undefined : matched;
  }, [fieldsFilter, fields]);

  // Configure submission only when the caller provides a writeCommand; with
  // customSubmit, the form controller has no submit wiring because
  // controller.submit() is not called.
  const writeVerb = isCreateMode ? "create" : "update";
  // A write-excluded field must never reach the payload: the handler schema is
  // z.never() for it, so even an unchanged read-only value would be rejected.
  const omitFields = useMemo(
    () => [
      ...layoutEditFields(screen)
        .filter((spec) => spec.submit === false)
        .map((spec) => spec.field),
      ...(screen.writeExcludedFields?.[writeVerb] ?? []),
    ],
    [screen, writeVerb],
  );
  const submitConfig =
    writeCommand !== undefined
      ? {
          type: writeCommand,
          payloadMode,
          ...(buildPayload !== undefined && { buildPayload }),
          ...(omitFields.length > 0 && { omitFields }),
          ...(serverFieldPathPrefix !== undefined && { serverFieldPathPrefix }),
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

  // Derived fields are written into form state (not only displayed) so required
  // validation and the submit payload carry them; only a real change is set, which
  // keeps this from looping.
  useEffect(() => {
    if (formDerivation === undefined) return;
    const patch = changedDerivedValues(snapshot.values, formDerivation);
    if (patch !== undefined) controller.setValues(patch as Partial<TValues>); // @cast-boundary form-values
  }, [snapshot.values, formDerivation, controller]);

  // Wired at the user-input boundary, not in controller.setField: computed
  // fields, prefill, draft restore and action patches also call setValues
  // after a failed submit and must not wipe the errors.
  const clearErrorsOnInput = (changedField: string): void => {
    const errors = controller.getSnapshot().errors;
    const remaining = issuesAfterEdit(errors, changedField);
    if (remaining !== errors) controller.setErrors(remaining);
    if (formErrorSource === "submit" && formError?.code !== "version_conflict") {
      setFormError(null);
    }
  };

  const lastRefreshTokenRef = useRef(refreshToken);
  useEffect(() => {
    if (lastRefreshTokenRef.current === refreshToken) return;
    lastRefreshTokenRef.current = refreshToken;
    // Never overwrite user input: a dirty form keeps its values.
    if (controller.getSnapshot().isDirty) return;
    controller.setValues(initial);
    controller.rebase();
  }, [refreshToken, controller, initial]);

  // Controlled mode. Both callbacks live in refs so a
  // re-rendering caller (identity-unstable `onChange`/`onControlsReady`
  // closures, e.g. inline arrows) doesn't retrigger these effects — only a
  // real snapshot mutation (typing, patch()) does. Without this, a caller
  // whose onChange calls patch() to fill other fields (the VIN-decode use
  // case) would loop: patch → new snapshot → effect
  // re-subscribes with a "new" onChange → refires.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Guards against redelivering to the SAME callback identity on every
  // render (an inline-arrow onControlsReady would otherwise refire the
  // effect below on every render since the callback itself is now a dep).
  // Tracks the actual prop, not a ref snapshot, so a caller that swaps in a
  // real handler after mount (e.g. `onControlsReady={ready ? cb : undefined}`)
  // gets delivered to for THIS mount instead of never.
  const deliveredControlsToRef = useRef<typeof onControlsReady>(undefined);
  const onControlsReadyRef = useRef(onControlsReady);
  onControlsReadyRef.current = onControlsReady;
  const hasNavigatedRef = useRef(false);
  const submittedRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const scopeFieldNamesRef = useRef(scopeFieldNames);
  scopeFieldNamesRef.current = scopeFieldNames;
  const scopedValidate = useCallback(
    () => controller.validate(scopeFieldNamesRef.current),
    [controller],
  );
  const markSaved = useCallback(() => {
    controller.rebase();
    extensionDirtyRef.current = false;
    setExtensionDirty(false);
  }, [controller]);

  // `saveDraft` (defined below) is a fresh closure every render, over that
  // render's `draftKey`/`draftId` — the ref lets the debounce timer below
  // always call the CURRENT one even though the timer was scheduled by an
  // earlier render's patch() call. `currentStepRef` gives it the current
  // wizard step without depending on `currentStep` (computed further down,
  // from `filteredSections`) at the point patchAndScheduleDraftSave itself
  // is defined — kept fresh where `currentStep` is computed below.
  const saveDraftRef = useRef<(stepIndex: number) => void>(() => {});
  // `handleSubmit` (defined below) is a fresh closure over this render's
  // snapshot/extensionDirty, while the onControlsReady effect fires once per
  // mount — the ref lets controls.submit() always reach the current one.
  const handleSubmitRef = useRef<(options?: { readonly saveNow?: boolean }) => Promise<void>>(
    async () => {},
  );
  const wizardNextRef = useRef<() => void>(() => {});
  const wizardBackRef = useRef<() => void>(() => {});
  const currentStepRef = useRef(0);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (draftSaveTimerRef.current !== null) {
        clearTimeout(draftSaveTimerRef.current);
        // Flush the pending debounced save instead of dropping it — a
        // navigation/unmount inside the debounce window would otherwise
        // silently discard the last patch() (discardDraft nulls this ref
        // first on the post-submit path, so this can't resurrect a
        // just-submitted draft).
        saveDraftRef.current(currentStepRef.current);
      }
    };
  }, []);

  // patch() (controlled mode, extension sections) applies immediately —
  // only the resulting draft save is debounced, so a patch() burst
  // (VIN-decode filling several fields, or onChange fanning a keystroke out
  // through patch(), see the VIN-decode test above) collapses into one save.
  const patchAndScheduleDraftSave = useCallback(
    (partial: Partial<TValues>) => {
      controller.setValues(partial);
      if (!draftEnabled || dispatcher === undefined || disabled || submittedRef.current) return;
      if (draftSaveTimerRef.current !== null) clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = setTimeout(() => {
        draftSaveTimerRef.current = null;
        if (disabled || submittedRef.current) return;
        saveDraftRef.current(currentStepRef.current);
      }, PATCH_DRAFT_SAVE_DEBOUNCE_MS);
    },
    [controller, draftEnabled, dispatcher, disabled],
  );

  // Runs before the onChange effect below (declaration order = React
  // execution order) so that an onChange fired on mount always sees
  // `controls !== undefined` — both effects depend only on mount-stable
  // values (controller/scopedValidate/patchAndScheduleDraftSave), so the
  // swap is otherwise a no-op. See the VIN-decode test: an initial
  // value that should derive dependent fields on mount needs controls.patch
  // available on the very first onChange call, not just from the second
  // keystroke onward.
  const hasControlsReady = onControlsReady !== undefined;
  useEffect(() => {
    if (!hasControlsReady) return;
    const ready = onControlsReadyRef.current;
    if (ready === undefined) return;
    if (deliveredControlsToRef.current === ready) return;
    deliveredControlsToRef.current = ready;
    ready({
      patch: patchAndScheduleDraftSave,
      validate: scopedValidate,
      getValues: () => controller.getSnapshot().values,
      // saveNow: a host-driven submit must save on a wizard's intermediate
      // steps too instead of silently advancing; stepping is next()/back().
      submit: () => handleSubmitRef.current({ saveNow: true }),
      next: () => wizardNextRef.current(),
      back: () => wizardBackRef.current(),
    });
    // Dep on boolean presence only — inline-arrow identity must not redeliver.
  }, [hasControlsReady, controller, scopedValidate, patchAndScheduleDraftSave]);

  // `schema` is typically an inline caller prop (`schema={z.object({...})}`)
  // with unstable identity across renders — as an effect dep it would refire
  // on every parent render, not just on a snapshot change, risking a loop if
  // the caller's onChange triggers a parent re-render. Held in a ref like
  // onChangeRef so only a real snapshot mutation retriggers this effect.
  const schemaRef = useRef(schema);
  schemaRef.current = schema;
  // Controls are guaranteed ready by the time this fires (see the
  // onControlsReady effect above, which is declared first on purpose).
  useEffect(() => {
    const cb = onChangeRef.current;
    if (cb === undefined) return;
    // Dry-run parse against `schema` — NOT controller.validate(). Calling
    // validate() here would write field-level errors into snapshot.errors
    // on every keystroke, painting error messages while the user is still
    // typing. `valid` can therefore legitimately diverge from what's
    // currently rendered under the fields (the last *mutating* validate()
    // call, e.g. from controls.validate() or submit()). The issues are
    // filtered exactly like submit()'s validate: hidden fields and fields
    // outside the `fields` scope never make the form invalid.
    const currentSchema = schemaRef.current;
    const valid =
      currentSchema === undefined ||
      dryRunFieldIssues(currentSchema, snapshot, scopeFieldNamesRef.current, true).length === 0;
    cb({
      values: snapshot.values,
      changes: snapshot.changes,
      dirty: snapshot.isDirty,
      valid,
      submitting: isSubmitting,
    });
  }, [snapshot, isSubmitting]);

  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;
  const hasUnsavedInput = snapshot.isDirty || extensionDirty;
  useEffect(() => {
    onDirtyChangeRef.current?.(hasUnsavedInput);
  }, [hasUnsavedInput]);

  // Draft wizards keep their input server-side, so leaving loses nothing.
  const persistsDraft = isWizard && screen.layout.draft === true;
  useUnsavedInputSource(
    () => !persistsDraft && (controller.getSnapshot().isDirty || extensionDirtyRef.current),
  );

  useWizardFormDraftRestore<TValues>({
    screenId: screen.id,
    isCreateMode,
    draftEnabled,
    dispatcher,
    controller,
    hasNavigatedRef,
    setRawStep,
    draftState,
  });

  const vm = useMemo(
    () =>
      computeEditViewModel({
        screen,
        entity,
        values: snapshot.values,
        translate,
        featureName,
        mode: writeVerb,
        ...(!isCreateMode && entityIdProp != null && { entityId: entityIdProp }),
        ...(formDerivation !== undefined && { derivation: formDerivation }),
        ...(actionFormScreenQn !== undefined && { actionFormScreenQn }),
      }),
    [
      formDerivation,
      actionFormScreenQn,
      screen,
      entity,
      snapshot.values,
      translate,
      featureName,
      writeVerb,
      isCreateMode,
      entityIdProp,
    ],
  );

  const filteredSections = useMemo(
    // A fully-hidden "fields" section (every field in it currently
    // condition-hidden) must not occupy a wizard step; it would render
    // empty and block Back/Next on nothing. Extension, relatedList and
    // writeForm sections carry no `visible` (they own their own lifecycle /
    // run their own query / own submit), so they always pass through. A
    // section with no fields at all (e.g. a review-only step) has
    // `visible: fields.some(...)` = false vacuously; that's "no fields to
    // hide", not "hidden", so it stays too. Unless the create
    // exclusion emptied it: that would leave an empty wizard step / tab.
    () =>
      filterEditSections(vm.sections, fieldsFilter).filter(
        (section) =>
          section.kind === "extension" ||
          section.kind === "relatedList" ||
          section.kind === "writeForm" ||
          (section.fields.length === 0 && section.emptiedByWriteExclusion !== true) ||
          section.visible,
      ),
    [vm.sections, fieldsFilter],
  );

  const allFieldsRequired = useMemo(() => {
    const fillable = filteredSections.flatMap((section) =>
      section.kind === "fields"
        ? section.fields.filter(
            (field) => field.visible && !field.readOnly && field.type !== "boolean",
          )
        : [],
    );
    return fillable.length > 0 && fillable.every((field) => field.required);
  }, [filteredSections]);

  const showsAllRequiredHint = allFieldsRequired && hideSectionTitles !== true && !isWizard;

  // true when editable fields exist or an extension opted into composed submit.
  const isFormEditable = hasEditableSection(filteredSections);
  // A fieldless form (input-less secretMint mint — the secret is
  // server-generated, the mint step is only its submit button) has no
  // section to gate on: it IS the action, so it always shows the submit
  // button, and it can never go dirty either.
  const isFieldless = Object.keys(entity.fields).length === 0;

  // A lone relatedList tab (`hideSectionTitles` is only ever set by
  // ProjectionDetailBody, which hands this component ONE section — its
  // synthesized screen drops layout.mode, so an entityEdit tabs layout never
  // reaches this line and `filteredSections[0]` stays the active section)
  // needs its own tab panel capped at the available height so its table
  // scrolls inside the panel instead of the whole page stretching to the
  // row count — a short table still sizes to its content instead
  // of stretching the panel to the bottom. Any other layout —
  // multiple sections, a non-relatedList tab, stacked (non-tabs) forms —
  // keeps normal document-flow height untouched.
  const fillHeight =
    fillScreenHeight === true ||
    (hideSectionTitles === true && filteredSections[0]?.kind === "relatedList");

  // A lone writeForm tab is the whole page, so its submit joins this form's
  // footer (pinned to the window edge like every other screen's save)
  // instead of sitting in the section's title row.
  const isLoneWriteFormTab =
    hideSectionTitles === true && filteredSections[0]?.kind === "writeForm";
  const [writeFormFooterAction, setWriteFormFooterAction] = useState<ReactNode>(undefined);

  // Persist all composed extension sections using the resolved entityId.
  // false means a section failed and its i18n key is shown in the banner. Without
  // entity context (create mode without a route id), there is nothing to write.
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
  const activeTabIndex =
    isTabs && activeTabId !== undefined
      ? filteredSections.findIndex((s, i) => tabIdAt(s, i) === activeTabId)
      : -1;
  const currentStep = activeTabIndex !== -1 ? activeTabIndex : Math.min(rawStep, lastStepIndex);
  // Kept fresh for patchAndScheduleDraftSave's debounce timer above, which
  // is defined before `currentStep` exists (it depends on `filteredSections`,
  // computed further up from `vm`) and so cannot close over it directly.
  currentStepRef.current = currentStep;
  const isLastWizardStep = currentStep >= lastStepIndex;

  const wizardDoneSteps = useMemo(() => {
    if (!isWizard || isCreateMode) return undefined;
    const parse =
      schema === undefined
        ? undefined
        : dryRunParse(schema, { values: snapshot.values, fields: snapshot.fields });
    return filteredSections.map((section, index) => {
      if (passedStepKeys.has(wizardStepKey(section, index))) return true;
      if (section.kind === "fields") return isFieldsStepFilled(section, parse);
      return (
        section.kind === "extension" &&
        extensionStepComplete[wizardStepKey(section, index)] === true
      );
    });
  }, [
    isWizard,
    isCreateMode,
    filteredSections,
    passedStepKeys,
    extensionStepComplete,
    schema,
    snapshot.values,
    snapshot.fields,
  ]);
  const updateModeStepBarProps =
    wizardDoneSteps === undefined
      ? {}
      : { doneSteps: wizardDoneSteps, selectableSteps: "all" as const };

  function jumpToStep(index: number): void {
    setRawStep(index);
    if (isTabs) setActiveTabId(tabIdAt(filteredSections[index], index));
  }

  const { adoptDraft, saveDraft, discardDraft } = buildWizardDraftActions<TValues>({
    screenId: screen.id,
    isCreateMode,
    draftEnabled,
    disabled,
    dispatcher,
    draftStorage,
    controller,
    sections: vm.sections,
    draftSaveTimerRef,
    draftState,
  });
  saveDraftRef.current = saveDraft;

  // Next: scoped validate() on the current step's fields — errors stay
  // attached to the field and block the step transition. Extension steps
  // have no field scope here (they validate via the controlled-mode
  // controls.validate() API), so no call, no clearing of unrelated errors.
  function handleWizardNext(): void {
    const next = Math.min(currentStep + 1, lastStepIndex);
    hasNavigatedRef.current = true;
    // Locked state: `disabled` means "no input/no write", not "no
    // navigation" — a disabled wizard must still be steppable so Back/Next
    // reach every step. But neither validate() (would block on an empty
    // required field nobody can fill in) nor saveDraft() (would mint a
    // draftId / dispatch a write — exactly what `disabled` forbids) may run.
    if (disabled) {
      setRawStep(next);
      return;
    }
    // skip: the current step has field errors — no transition, no draft save.
    if (currentStepHasFieldErrors()) return;
    if (!isCreateMode) {
      const leftSection = filteredSections[currentStep];
      if (leftSection !== undefined) {
        const leftKey = wizardStepKey(leftSection, currentStep);
        setPassedStepKeys((prev) => (prev.has(leftKey) ? prev : new Set(prev).add(leftKey)));
      }
    }
    setRawStep(next);
    saveDraft(next);
  }

  function currentStepHasFieldErrors(): boolean {
    const section = filteredSections[currentStep];
    const fieldNames = section?.kind === "fields" ? section.fields.map((f) => f.field) : [];
    return fieldNames.length > 0 && !controller.validate(fieldNames);
  }

  function handleWizardBack(): void {
    handleWizardStepSelect(currentStep - 1);
  }

  // Update mode: the record already exists and the final Save validates the
  // whole form and jumps to the first erroring step (findFirstErroringStep), so
  // skipping steps forward is safe; leaving the current step still goes through
  // its validate gate.
  function handleWizardStepSelect(targetStep: number): void {
    if (targetStep === currentStep) return;
    const isForward = targetStep > currentStep;
    // Create mode: a forward jump would skip the per-step validate() gate.
    if (isForward && isCreateMode) return;
    if (isForward && !disabled && currentStepHasFieldErrors()) return;
    const clampedTarget = Math.min(Math.max(targetStep, 0), lastStepIndex);
    hasNavigatedRef.current = true;
    setRawStep(clampedTarget);
    if (!disabled) saveDraft(clampedTarget);
  }

  // Stepped modes (wizard, tabs): locates the first step whose "fields"
  // section contains one of the given field paths — matched on the path's
  // first segment, since `FieldIssue.path`/`snapshot.errors` keys can be
  // dotted (embedded-list rows, e.g. `tasks.2.title`) while a section's field
  // name is always the plain top-level name. Returns undefined for a
  // root-level issue (path `"(root)"`, see zod-bridge.ts) or one that matches
  // no rendered field — callers must NOT suppress the error banner in that
  // case, there is nowhere to jump the user to. Extension sections are not
  // jump targets by design: they validate through the controlled-mode
  // controls.validate() API and own no field specs to match against.
  function findFirstErroringStep(fieldPaths: readonly string[]): number | undefined {
    return findFirstErroringSectionIndex(filteredSections, fieldPaths);
  }

  async function handleSubmit(options?: { readonly saveNow?: boolean }): Promise<void> {
    // Enter in the active step triggers the native form submit (Next is
    // type="submit" for Enter support) — on intermediate steps that means
    // "Next", not "Save". Checked BEFORE the `disabled` guard below:
    // `disabled` means "no input/no write", not "no navigation" — a
    // disabled wizard must still be steppable (handleWizardNext itself
    // blocks validate()/saveDraft() while disabled). `saveNow` is the explicit
    // "Save and close" button and skips the step advance.
    if (isWizard && !isLastWizardStep && options?.saveNow !== true) {
      handleWizardNext();
      return;
    }
    // Locked state: the submit button is visibly disabled, but a
    // native form submit (Enter key) reaches this handler regardless of the
    // button's disabled attribute — block it here too, not just in the UI.
    if (disabled || submitBlocked) return;
    // Sync guard — React state `isSubmitting` is too late for double-clicks
    // in the same tick (customSubmit has no submitInFlight of its own).
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setExtensionErrorKey(null);
    try {
      // Extension-only: only a section is dirty and the main form is unchanged.
      // Skip the entity write (it would send an empty changes payload) and only
      // run the section handlers.
      if (snapshot.isUnchanged && extensionDirty) {
        // Same discard as the main path: an extension-only save is still a
        // successful submit, so the draft must not survive it.
        if (await persistExtensions()) {
          extensionDirtyRef.current = false;
          submittedRef.current = true;
          await discardDraft();
        }
        return;
      }
      let result: SubmitResult<unknown>;
      if (customSubmit !== undefined) {
        // customSubmit path (e.g. configEdit, which performs a separate write per
        // field). Validate on the client first, then call the caller; on success,
        // explicitly rebase the form state because controller.submit() normally
        // does this itself, and the controller otherwise knows nothing about a
        // successful custom submission (isUnchanged would remain false).
        //
        // Read the snapshot directly from the controller rather than React state.
        // With rapid fill-then-click input, React batching may not have committed
        // state updates when the submit click fires. handleSubmit's closure could otherwise
        // see stale snapshot.changes={} and perform no writes, then return success
        // and rebase the form, making it appear that the data was saved.
        // controller.getSnapshot() is always current: the controller is the
        // source of truth, while React state is only a rendering mirror.
        const valid = controller.validate(scopeFieldNames);
        if (!valid) {
          // Field order matters: validationBlocked:true is its own
          // variant in the SubmitResult union (NOT mixed with data/error);
          // TS only narrows cleanly without a discriminator fight.
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
      // Form-level errors (without field-level details) go to the banner.
      // Field errors flow via snapshot.errors into the individual fields.
      let extensionsPersisted = true;
      if (result.isSuccess) {
        setFormError(null);
        setExtraDeleteIssues([]);
        // `isNoOp: true` (payloadMode "changes", pre-filled form submitted
        // untouched) means controller.submit() never called dispatcher.write
        // — nothing to discard, and discarding here would delete a draft the
        // form never persisted. Awaited, not fire-and-forget:
        // `onSubmit` typically navigates away and unmounts this form, which
        // would abort an in-flight discard and leave the draft behind after
        // a successful submit.
        if (result.isNoOp !== true) {
          submittedRef.current = true;
          await discardDraft();
        }
        extensionsPersisted = await persistExtensions();
        if (extensionsPersisted) extensionDirtyRef.current = false;
      } else if (result.validationBlocked) {
        setFocusFirstErrorKey((key) => key + 1);
        // Root-level `.refine()`/cross-field issues from controller.validate()
        // — same "jump to the erroring step" treatment as a server field
        // error below, sourced from the freshly-validated snapshot.
        if (isStepped) {
          const step = findFirstErroringStep(Object.keys(controller.getSnapshot().errors));
          if (step !== undefined) jumpToStep(step);
        }
      } else {
        const fieldIssues = result.error.details?.fields ?? [];
        const issuePaths = fieldIssues.map((i) => i.path);
        if (fieldIssues.length > 0) setFocusFirstErrorKey((key) => key + 1);
        // controller.submit() writes server issues into the controller itself;
        // customSubmit bypasses it, so push them here to reach the fields.
        if (customSubmit !== undefined && fieldIssues.length > 0) {
          controller.setErrors(groupIssuesByPath(fieldIssues));
        }
        // A server field error on a step the form isn't currently showing is
        // otherwise invisible — jump to the first step that contains one of
        // the errored fields. For tabs this is what keeps the submit from
        // blocking in silence, the failure mode the boot-validator used to
        // prevent by rejecting the layout outright. An issue no
        // rendered field can show (`version`, `id`, a root-level refine, a
        // hidden field) keeps the banner, jump or not.
        if (isStepped) {
          const step = findFirstErroringStep(issuePaths);
          if (step !== undefined) jumpToStep(step);
        }
        setExtraDeleteIssues([]);
        setFormErrorSource("submit");
        setFormError(
          hasIssueWithoutRenderedField(
            issuePaths,
            filteredSections,
            new Set(Object.keys(formDerivation?.derive ?? {})),
          )
            ? result.error
            : null,
        );
      }
      // skip: on entity-success-but-extension-failure the extension-error
      // banner is showing — don't notify (the caller navigates away on success
      // and would unmount it before the user sees the failure).
      if (shouldNotifyCaller(result, extensionsPersisted)) {
        onSubmit?.(result, controller.getSnapshot().values);
      }
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }
  handleSubmitRef.current = handleSubmit;
  wizardNextRef.current = isWizard ? handleWizardNext : () => {};
  wizardBackRef.current = isWizard ? handleWizardBack : () => {};

  // Screen forms (entityEdit/actionForm filling the shell height) drop the card;
  // the title then lives in the shell header when the shell offers a slot.
  const rootIssues = snapshot.errors[ROOT_ISSUE_PATH] ?? [];
  const isScreenForm = fillScreenHeight === true && hideSectionTitles !== true && !insideDrawer;
  const titleInShell =
    PageHeader !== undefined &&
    pageHeaderSlotAvailable &&
    hideSectionTitles !== true &&
    headerRegion === undefined;
  const menuPageHeaderActions = titleInShell && isScreenForm && ActionOverflowMenu !== undefined;
  const cancelInHeaderMenu = menuPageHeaderActions && isWizard && onCancel !== undefined;
  // Two groups — wizard navigation on the right/top, record actions on the
  // left/below; destructive action sits outermost, farthest from the target
  // action.
  const hasSecondaryFormActions =
    (!menuPageHeaderActions && (onDelete !== undefined || onCopyLink !== undefined)) ||
    (actions !== undefined && actions.length > 0) ||
    (!menuPageHeaderActions && menuActions !== undefined && menuActions.length > 0) ||
    (onCancel !== undefined && !cancelInHeaderMenu);
  // Teil-C collapse rule: driven by the custom `actions` group only — a
  // resolved true also folds the Copy-Link button (same visual group in the
  // footer), but never Delete/Cancel, which keep their text regardless.
  const iconOnlyMidActions = actions !== undefined && shouldRenderActionsIconOnly(actions);
  const headerMenuItems: readonly ActionMenuItemSpec[] = menuPageHeaderActions
    ? [
        ...(menuActions ?? []).map(menuActionToItem),
        ...(onCopyLink !== undefined
          ? [
              {
                id: "copy-link",
                label: translate(
                  linkCopied ? "kumiko.actions.copyLinkCopied" : "kumiko.actions.copyLink",
                ),
                icon: "link" as const,
                onSelect: () => {
                  void Promise.resolve(onCopyLink()).then(() => setLinkCopied(true));
                },
              },
            ]
          : []),
        ...(cancelInHeaderMenu
          ? [
              {
                id: "cancel",
                label: translate("kumiko.actions.cancel"),
                icon: "x" as const,
                onSelect: () => onCancel(),
              },
            ]
          : []),
        ...(onDelete !== undefined
          ? [
              {
                id: "delete",
                label: translate("kumiko.actions.delete"),
                icon: "trash" as const,
                variant: "danger" as const,
                onSelect: () => setConfirmDeleteOpen(true),
              },
            ]
          : []),
      ]
    : [];
  const secondaryFormActions = (
    <>
      {onDelete !== undefined && !menuPageHeaderActions && (
        <Button
          type="button"
          variant="danger-ghost"
          icon="trash"
          testId="render-edit-delete"
          disabled={disabled}
          onClick={() => setConfirmDeleteOpen(true)}
        >
          {translate("kumiko.actions.delete")}
        </Button>
      )}
      {onCopyLink !== undefined && !menuPageHeaderActions && (
        <Button
          type="button"
          variant={iconOnlyMidActions ? "secondary" : "link"}
          icon={linkCopied ? "check" : "link"}
          testId="render-edit-copy-link"
          {...(iconOnlyMidActions && {
            size: "icon" as const,
            ariaLabel: translate(
              linkCopied ? "kumiko.actions.copyLinkCopied" : "kumiko.actions.copyLink",
            ),
          })}
          onClick={async () => {
            await onCopyLink();
            setLinkCopied(true);
          }}
        >
          {iconOnlyMidActions
            ? null
            : translate(linkCopied ? "kumiko.actions.copyLinkCopied" : "kumiko.actions.copyLink")}
        </Button>
      )}
      {actions?.map((action) => (
        <RenderEditActionButton
          key={action.id}
          action={action}
          iconOnly={iconOnlyMidActions}
          Button={Button}
          Dialog={Dialog}
          onError={setActionError}
        />
      ))}
      {!menuPageHeaderActions &&
        menuActions?.map((action) => (
          <RenderEditActionButton
            key={action.id}
            action={action}
            Button={Button}
            Dialog={Dialog}
            onError={setActionError}
          />
        ))}
      {onCancel !== undefined && !cancelInHeaderMenu && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => onCancel()}
          testId="render-edit-cancel"
        >
          {translate("kumiko.actions.cancel")}
        </Button>
      )}
    </>
  );
  const headerSlot = screen.slots?.header;
  const headerSlotMount =
    headerSlot !== undefined ? (
      <EditSlotMount
        slot={headerSlot}
        slotName="header"
        screenId={screen.id}
        entityName={vm.entityName}
        entityId={resolveExtensionEntityId(entityIdProp, vm.id)}
        values={snapshot.values}
      />
    ) : undefined;
  // A function headerRegion places the slot itself (projectionDetail puts it
  // into its header card next to the actions); otherwise the slot renders
  // above the caller's own headerRegion.
  const formHeaderRegion =
    typeof headerRegion === "function" ? (
      headerRegion(headerSlotMount)
    ) : headerSlotMount !== undefined ? (
      <>
        {headerSlotMount}
        {headerRegion}
      </>
    ) : (
      headerRegion
    );
  const titleActionSlot = screen.slots?.titleAction;
  const titleActionMount =
    titleActionSlot !== undefined ? (
      <EditSlotMount
        slot={titleActionSlot}
        slotName="titleAction"
        screenId={screen.id}
        entityName={vm.entityName}
        entityId={resolveExtensionEntityId(entityIdProp, vm.id)}
        values={snapshot.values}
      />
    ) : undefined;
  // A projectionDetail's synthesized entity is empty when every section is an
  // extension or relatedList; that is not a fieldless submit form, so it must not
  // draw a no-op Save. Extension registrations still get their Save, since
  // persistExtensions() runs on the customSubmit path too.
  const isFieldlessSubmitForm = isFieldless && screen.entity !== PROJECTION_DETAIL_ENTITY;
  const showsSubmit =
    !viewMode &&
    (isFormEditable ||
      hasExtensionRegistrations ||
      isFieldlessSubmitForm ||
      submitWithoutChanges !== undefined);
  const footerSlot = screen.slots?.footer;
  // An unregistered footer component renders null, so only a resolvable one may
  // count as an action (else read-only screens get an empty footer strip).
  const FooterSlotComponent = useExtensionSectionComponent(
    footerSlot !== undefined ? extensionSectionName(footerSlot) : undefined,
  );
  // Mirrors every branch inside formActions below — without this guard
  // DefaultForm renders an empty footer strip (border + padding, no content)
  // on read-only detail screens, since `actions` would otherwise always be
  // a defined (if empty) fragment.
  const showWizardBack = isWizard && currentStep > 0;
  const showWizardNext = isWizard && !isLastWizardStep;
  const showSubmit = showsSubmit && (!isWizard || isLastWizardStep);
  const hasFormActions =
    showWizardBack ||
    showWizardNext ||
    showSubmit ||
    FooterSlotComponent !== undefined ||
    writeFormFooterAction !== undefined;
  const nextStepTitle = isWizard ? filteredSections[currentStep + 1]?.title : undefined;
  const isCreate = (() => {
    const id = resolveExtensionEntityId(entityIdProp, vm.id);
    return id == null || id === "";
  })();
  const changedFieldCount = Object.keys(snapshot.changes).length;
  // Edit-mode screen forms always carry the dirty status (0 = quiet "No unsaved
  // changes"); wizards keep the status-only-when-dirty behaviour.
  const hasDirtyFooter =
    !isWizard &&
    !viewMode &&
    (dirtyFooter === true || (isScreenForm && !isCreate && headerRegion === undefined));
  const unsavedCount = !hasDirtyFooter
    ? undefined
    : changedFieldCount > 0
      ? changedFieldCount
      : extensionDirty
        ? 1
        : 0;
  const isSettingsList = screen.layout.variant === "settings-list" && hideSectionTitles !== true;
  const formActions = (
    <>
      {showWizardBack && (
        <Button
          type="button"
          variant="secondary"
          icon="chevron-left"
          onClick={handleWizardBack}
          testId="render-edit-wizard-back"
          {...{ [FOOTER_ACTION_ROLE_PROP]: "back" as const }}
        >
          {translate("kumiko.actions.back")}
        </Button>
      )}
      {footerSlot !== undefined && (
        <EditSlotMount
          slot={footerSlot}
          slotName="footer"
          screenId={screen.id}
          entityName={vm.entityName}
          entityId={resolveExtensionEntityId(entityIdProp, vm.id)}
          values={snapshot.values}
          markSaved={markSaved}
          hasUnsavedChanges={hasUnsavedInput}
          wizardStep={isWizard ? { index: currentStep, isLast: isLastWizardStep } : undefined}
          {...(screen.slots?.footerPrimary === true && { [STICKY_PRIMARY_ACTION_PROP]: true })}
        />
      )}
      {isWizard && !isLastWizardStep && showsSubmit && !isCreateMode && (
        <Button
          type="button"
          variant="ghost"
          disabled={isSubmitting || disabled}
          onClick={() => void handleSubmit({ saveNow: true })}
          testId="render-edit-wizard-save-close"
          {...{ [STICKY_PRIMARY_ACTION_PROP]: true }}
        >
          {translate("kumiko.wizard.save-and-close")}
        </Button>
      )}
      {showWizardNext && (
        <Button
          type="submit"
          variant="primary"
          iconEnd="chevron-right"
          testId="render-edit-wizard-next"
          {...{
            [FOOTER_ACTION_ROLE_PROP]: "primary" as const,
            [NARROW_LABEL_PROP]: translate("kumiko.actions.next"),
          }}
        >
          {nextStepTitle !== undefined
            ? translate("kumiko.wizard.next-with-title", { title: nextStepTitle })
            : translate("kumiko.actions.next")}
        </Button>
      )}
      {showSubmit &&
        footerActions?.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant={action.variant ?? "secondary"}
            {...(action.icon !== undefined && { icon: action.icon })}
            disabled={isSubmitting || disabled}
            onClick={() => {
              controller.setValues(action.patch as Partial<TValues>); // @cast-boundary form-values
              void handleSubmit();
            }}
            testId={`render-edit-footer-action-${action.id}`}
          >
            {translate(action.label)}
          </Button>
        ))}
      {hasDirtyFooter && showsSubmit && unsavedCount !== undefined && unsavedCount > 0 && (
        <Button
          type="button"
          variant="ghost"
          disabled={isSubmitting || disabled}
          onClick={() => controller.reset()}
          testId="render-edit-discard"
          {...{ [STICKY_PRIMARY_ACTION_PROP]: true }}
        >
          {translate("kumiko.form.discard")}
        </Button>
      )}
      {showSubmit && (
        <Button
          type="submit"
          disabled={
            (snapshot.isUnchanged &&
              !extensionDirty &&
              !isFieldlessSubmitForm &&
              !insideDrawer &&
              submitWithoutChanges !== true) ||
            isSubmitting ||
            disabled ||
            submitBlocked
          }
          loading={isSubmitting}
          variant={submitVariant ?? "primary"}
          testId="render-edit-submit"
        >
          {translate(
            submitLabel ??
              (isWizard
                ? "kumiko.actions.finish"
                : hasDirtyFooter
                  ? "kumiko.form.saveChanges"
                  : "kumiko.actions.save"),
          )}
        </Button>
      )}
      {writeFormFooterAction}
    </>
  );

  // Title + Subtitle, create/edit-aware. i18n-Keys (mode = "create"|"edit"):
  //   screen:<id>.<mode>.title / .<mode>.subtitle  (mode = "create"|"edit"|"view")
  // Fallback chain: mode-specific → generic (screen:<id>.title/.subtitle).
  // title falls back to screenId; subtitle falls back to screen.description,
  // itself run through translate() so an i18n key (the established
  // convention for description, e.g. bundled-features) resolves instead of
  // showing the raw key — translate() returns the input unchanged for plain
  // prose, same as it does for an unknown key. Same slot
  // section.description already fills for a section. Falls back to
  // undefined (no subtitle) when neither is set.
  const formMode = isCreate ? "create" : viewMode ? "view" : "edit";
  const recordTitle =
    !isCreate && screen.recordTitleField !== undefined
      ? resolveRecordTitle(initial[screen.recordTitleField])
      : undefined;
  const resolveScreenText = (suffix: string): string | undefined => {
    for (const key of [
      `screen:${i18nScreenId}.${formMode}.${suffix}`,
      `screen:${i18nScreenId}.${suffix}`,
    ]) {
      const value = translate(key);
      if (value !== key) return value;
    }
    return undefined;
  };
  const plainFormTitle = resolveScreenText("title") ?? i18nScreenId;
  const formTitle = resolveTitleTemplate(
    screen.titleTemplate,
    snapshot.values,
    translate,
    plainFormTitle,
  );
  // In tabs mode (hideSectionTitles) screen.description is dropped — the head
  // card carries it — but an explicit subtitle i18n override has no other
  // source there, so it stays unless it merely resolves to the description.
  const explicitSubtitle = resolveScreenText("subtitle");
  const descriptionSubtitle =
    screen.description !== undefined ? translate(screen.description) : undefined;
  const formSubtitle =
    hideSectionTitles !== true
      ? (explicitSubtitle ?? descriptionSubtitle)
      : explicitSubtitle !== descriptionSubtitle
        ? explicitSubtitle
        : undefined;

  // Embedded settings-list forms (dashboard panels) have no shell header: the
  // form title/subtitle move into the first section's header column instead of
  // floating as a heading above the band.
  const titleInSettingsHeader = isSettingsList && !titleInShell;
  const usesFieldFlow = isScreenForm || insideDrawer;
  // The caller's headerRegion already shows the record title in the shell page
  // header, so the type title ("Release") above the form would repeat it.
  const recordTitleInHeaderRegion =
    headerRegion !== undefined &&
    recordTitle !== undefined &&
    PageHeader !== undefined &&
    pageHeaderSlotAvailable;
  const allRequiredHint = (
    <Text variant="muted" testId="render-edit-all-required-hint">
      {translate("kumiko.form.all-required")}
    </Text>
  );
  const stepRail = isWizard && isScreenForm && StepBar !== undefined;
  const upNextSection =
    screen.layout.wizard?.aside?.upNext === true ? filteredSections[currentStep + 1] : undefined;
  const sectionNavItems: readonly FormSectionNavItem[] =
    isScreenForm && !isStepped
      ? filteredSections.flatMap((section, index) =>
          section.kind !== "extension" &&
          section.kind !== "relatedList" &&
          section.kind !== "writeForm" &&
          section.visible &&
          section.title !== undefined &&
          section.title !== formTitle
            ? [{ id: formSectionDomId(index), title: section.title }]
            : [],
        )
      : [];
  const compactStepLabel = (() => {
    const currentTitle = filteredSections[currentStep]?.title;
    return currentTitle !== undefined
      ? translate("kumiko.wizard.step-with-title", {
          current: currentStep + 1,
          total: lastStepIndex + 1,
          title: currentTitle,
        })
      : translate("kumiko.wizard.step", { current: currentStep + 1, total: lastStepIndex + 1 });
  })();

  return (
    <ExtensionFormRegistryProvider value={extensionFormRegistry}>
      {menuActionConfirmDialog}
      {titleInShell && (
        <PageHeader
          title={formTitle}
          {...(recordTitle !== undefined && { recordTitle })}
          {...(headerMenuItems.length > 0 &&
            pageHeaderCompact && { overflowItems: headerMenuItems })}
          {...(headerMenuItems.length > 0 &&
            !pageHeaderCompact &&
            ActionOverflowMenu !== undefined && {
              actions: (
                <ActionOverflowMenu
                  label={translate("kumiko.list.row-actions.more")}
                  items={headerMenuItems}
                  testId="render-edit-header-menu"
                />
              ),
            })}
        />
      )}
      <Form
        onSubmit={() => void handleSubmit()}
        {...(focusFirstErrorKey > 0 && { focusFirstErrorKey })}
        {...(hideSectionTitles !== true &&
          !titleInShell &&
          !titleInSettingsHeader &&
          !recordTitleInHeaderRegion && { title: formTitle })}
        {...(formSubtitle !== undefined &&
          !stepRail &&
          !titleInSettingsHeader && { subtitle: formSubtitle })}
        {...(isScreenForm && { screenForm: true })}
        {...(unsavedCount !== undefined &&
          (unsavedCount > 0 || hasDirtyFooter) && { unsavedCount })}
        {...(sectionNavItems.length > 0 && { sectionNav: sectionNavItems })}
        {...(stepRail && {
          sideRail: (
            <StepBar
              steps={filteredSections.map((section) => section.title ?? "")}
              currentIndex={currentStep}
              compactLabel={compactStepLabel}
              onStepSelect={handleWizardStepSelect}
              {...updateModeStepBarProps}
              orientation="vertical"
              heading={translate("kumiko.wizard.step", {
                current: currentStep + 1,
                total: lastStepIndex + 1,
              })}
              {...(formSubtitle !== undefined && { description: formSubtitle })}
              subtitles={filteredSections.map((section) =>
                section.kind === "fields" ? section.subtitle : undefined,
              )}
              {...(upNextSection !== undefined && {
                upNext: {
                  heading: translate("kumiko.wizard.up-next"),
                  title: upNextSection.title ?? "",
                  ...(upNextSection.kind === "fields" &&
                    upNextSection.subtitle !== undefined && { subtitle: upNextSection.subtitle }),
                },
              })}
              testId="render-edit-wizard-steps"
              compactTestId="render-edit-wizard-step-label"
            />
          ),
        })}
        {...(hideActions !== true && hasFormActions && { actions: formActions })}
        {...(hideActions !== true &&
          hasSecondaryFormActions && { secondaryActions: secondaryFormActions })}
        testId="render-edit-form"
        stickyActions={isWizard || fillScreenHeight === true}
        {...(screen.layout.width !== undefined && { width: screen.layout.width })}
        {...(formHeaderRegion !== undefined && { headerRegion: formHeaderRegion })}
        {...(titleActionMount !== undefined && { titleAction: titleActionMount })}
        {...(fillHeight && { fillHeight })}
        {...(hideSectionTitles === true && { chromeless: true })}
        {...(summary !== undefined && { summary })}
      >
        <AllFieldsRequiredProvider value={showsAllRequiredHint}>
          {leadContent}
          {showsAllRequiredHint && !insideDrawer && allRequiredHint}
          {draftCandidates !== null && (
            <Banner
              variant="info"
              testId="render-edit-draft-picker"
              actions={[
                ...draftCandidates.map((candidate) => (
                  <Button
                    key={candidate.id}
                    type="button"
                    variant="link"
                    onClick={() => adoptDraft(candidate)}
                    testId={`render-edit-draft-pick-${candidate.id}`}
                  >
                    {formatWhen(candidate.savedAt)}
                  </Button>
                )),
                <Button
                  key="start-new"
                  type="button"
                  variant="link"
                  onClick={() => setDraftCandidates(null)}
                  testId="render-edit-draft-start-new"
                >
                  {translate("kumiko.form.draft.start-new")}
                </Button>,
              ]}
            >
              <Text>
                {translate(
                  draftCandidates.length === 1
                    ? "kumiko.form.draft.resume-single"
                    : "kumiko.form.draft.resume-multiple",
                )}
              </Text>
            </Banner>
          )}
          {isWizard && !stepRail && (
            <>
              {Progress !== undefined && (
                <Progress
                  value={(currentStep + 1) / (lastStepIndex + 1)}
                  testId="render-edit-wizard-progress"
                />
              )}
              {/* No StepBar registered → keep the plain label RenderEdit always had (additive rollout, see CorePrimitives.StepBar). */}
              {StepBar === undefined ? (
                <Text variant="small" testId="render-edit-wizard-step-label">
                  {compactStepLabel}
                </Text>
              ) : (
                <StepBar
                  steps={filteredSections.map((section) => section.title ?? "")}
                  currentIndex={currentStep}
                  compactLabel={compactStepLabel}
                  onStepSelect={handleWizardStepSelect}
                  {...updateModeStepBarProps}
                  testId="render-edit-wizard-steps"
                  compactTestId="render-edit-wizard-step-label"
                />
              )}
            </>
          )}
          {isTabs &&
            isStepped &&
            (() => {
              // No Tabs primitive registered → every section renders stacked
              // (stepHidden below is gated on the same condition), which is the
              // single-layout behaviour. Degrading to one long form beats
              // hiding sections behind a strip that never drew.
              if (Tabs === undefined) return null;
              return (
                <Tabs
                  testId="render-edit-tabs"
                  items={filteredSections.map((section, index) => ({
                    id: tabIdAt(section, index),
                    label: section.title ?? "",
                  }))}
                  activeId={tabIdAt(filteredSections[currentStep], currentStep)}
                  onSelect={(id) => {
                    const index = filteredSections.findIndex((s, i) => tabIdAt(s, i) === id);
                    // skip: the strip reported an id no section owns.
                    if (index === -1) return;
                    jumpToStep(index);
                  }}
                />
              );
            })()}
          {filteredSections.map((section: EditSectionViewModel, sectionIndex: number) => {
            // turns this section's own `actions` (RowAction[]) into
            // already-bound buttons via the caller-supplied builder, rendered
            // through the same RenderEditActionButton the top-level `actions`
            // prop uses (same style/confirm/icon/error handling).
            const sectionActions = section.actions;
            const sectionActionsEl: ReactNode =
              sectionActions !== undefined && sectionActions.length > 0
                ? buildSectionActions?.(sectionActions)?.map((action) => (
                    <RenderEditActionButton
                      key={action.id}
                      action={action}
                      Button={Button}
                      Dialog={Dialog}
                      onError={setActionError}
                    />
                  ))
                : undefined;
            // Wizard steps and tabs stay mounted while off-screen (native
            // `hidden`, not unmounted) so an extension section's submit-registry
            // entry (useExtensionFormSubmit → registry.remove on unmount)
            // survives navigating past its step — otherwise Finish only ran the
            // last mounted step's handler and silently dropped earlier steps'
            // writes. For tabs this is also what makes ONE submit cover every
            // tab, including tabs the user never opened.
            const stepHidden = isStepped && sectionIndex !== currentStep;
            const wrapWizardStep = (key: string, el: ReactNode): ReactNode => {
              if (!isStepped) return el;
              if (WizardStepGroup === undefined) {
                throw new Error(
                  `RenderEdit: ${screen.layout.mode} layout requires primitives.WizardStepGroup, but none is registered.`,
                );
              }
              return (
                <WizardStepGroup
                  key={key}
                  hidden={stepHidden}
                  {...(hideSectionTitles === true && { inset: true })}
                >
                  {el}
                </WizardStepGroup>
              );
            };
            // Off-screen wizard steps stay mounted (see comment above) but must
            // not participate in native constraint validation, or the Next
            // button's `type="submit"` triggers the browser's full-form check
            // — including required fields on unvisited steps, which are not
            // focusable while hidden, so the wizard silently stops navigating
            // (only a console warning, no visible error). A plain `hidden`
            // attribute does NOT bar descendants from constraint validation on
            // web — see WizardStepGroupProps for what implementations must
            // guarantee.
            if (section.kind === "extension") {
              const mount = (
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
                    patchAndScheduleDraftSave as (
                      partial: Readonly<Record<string, unknown>>,
                    ) => void
                  }
                  validate={scopedValidate}
                  markSaved={markSaved}
                  hideTitle={hideSectionTitles}
                  {...(isWizard &&
                    !isCreateMode && {
                      stepKey: wizardStepKey(section, sectionIndex),
                      onReportStepComplete: reportExtensionStepComplete,
                    })}
                  // Tabs mode: actions move to the outer Card below — the inner
                  // Section is flattened (rendered inside this component's own
                  // Form) and would otherwise duplicate them.
                  {...(hideSectionTitles !== true &&
                    sectionActionsEl !== undefined && { actions: sectionActionsEl })}
                />
              );
              // Tabs mode: an unframed padded panel (the tab panel is the
              // surface), so extension content neither sits flush at the shell
              // edge nor touches the tab strip. testId stays only on the inner
              // Section — giving the wrapper the same one would register two
              // elements under one id.
              const wrapped =
                hideSectionTitles !== true ? (
                  mount
                ) : (
                  <Card
                    key={section.title}
                    options={{ framed: false }}
                    {...(sectionActionsEl !== undefined && {
                      slots: { headerActions: sectionActionsEl },
                    })}
                  >
                    {mount}
                  </Card>
                );
              return wrapWizardStep(section.title, wrapped);
            }
            if (section.kind === "relatedList") {
              // parentId is the displayed record's id — without it there's no
              // parent row whose related rows could be queried.
              // Rejected at boot in wizard layouts, so no WizardStepGroup here.
              const parentId = resolveExtensionEntityId(entityIdProp, vm.id);
              if (parentId === null) return null;
              const mount = (
                <RelatedListSection
                  key={section.title}
                  section={section}
                  parentId={parentId}
                  // @cast-boundary form-values: TValues is structurally a Record.
                  record={snapshot.values as unknown as Readonly<Record<string, unknown>>}
                  featureName={featureName}
                  translate={translate}
                  hideTitle={hideSectionTitles}
                  {...(refreshToken !== undefined && { refreshToken })}
                  {...(fillScreenHeight === true && { grow: true })}
                  // Tabs mode: actions move to the outer Card below — the
                  // hideTitle branch of RelatedListSection has no title row to
                  // render them into.
                  {...(hideSectionTitles !== true &&
                    sectionActionsEl !== undefined && { actions: sectionActionsEl })}
                  {...(onRelatedListDrawerAction !== undefined && {
                    onOpenDrawer: onRelatedListDrawerAction,
                  })}
                />
              );
              // Tabs mode: the table runs full-bleed under the tab strip (board
              // layout); the toolbar buttons live in the list's own toolbar.
              return hideSectionTitles === true ? (
                <div
                  key={section.title}
                  className={fillScreenHeight === true ? "flex min-h-0 flex-1 flex-col" : undefined}
                >
                  {mount}
                </div>
              ) : (
                mount
              );
            }
            if (section.kind === "writeForm") {
              // Own submit button + dispatcher call, entirely independent of
              // this screen's (nonexistent, on projectionDetail) form submit —
              // rejected at boot in wizard layouts, so no WizardStepGroup here.
              return (
                <WriteFormSection
                  key={section.title ?? `write-form-${sectionIndex}`}
                  section={section}
                  featureName={featureName}
                  translate={translate}
                  hideTitle={hideSectionTitles}
                  onSubmitted={() => onReload?.()}
                  {...(isLoneWriteFormTab && { onFooterAction: setWriteFormFooterAction })}
                  {...(sectionActionsEl !== undefined && { actions: sectionActionsEl })}
                />
              );
            }
            if (!section.visible) return null;
            // Title-less sections would otherwise collide on key/testId, so use the index
            // as a fallback.
            const sectionKey = section.title ?? `section-${sectionIndex}`;
            const renderFieldGrid = (
              fields: readonly EditFieldViewModel[],
              columns: number,
              gridKey: string,
            ): ReactNode => (
              <Grid
                key={gridKey}
                columns={columns}
                {...(isSettingsList ? { list: true } : usesFieldFlow && { flow: true })}
              >
                {fields.map((field: EditFieldViewModel) => (
                  <GridCellForField
                    key={field.field}
                    field={disabled ? { ...field, readOnly: true } : field}
                    columns={columns}
                    {...(!isSettingsList && usesFieldFlow && { flow: true })}
                    {...(isSettingsList && {
                      layout: "row" as const,
                      accent: fieldAccent?.(field.field) === true,
                    })}
                    issues={snapshot.errors[field.field]}
                    onChange={(v) => {
                      (controller.setField as (k: string, v: unknown) => void)(field.field, v);
                      clearErrorsOnInput(field.field);
                      if (validateOnChange === true) controller.validate([field.field]);
                    }}
                    GridCell={GridCell}
                    featureName={featureName}
                    {...(labelAppendix !== undefined && {
                      labelAppendix: labelAppendix(field.field),
                    })}
                    {...(fieldAppendix !== undefined && {
                      fieldAppendix: fieldAppendix(field.field),
                    })}
                    {...(fieldAppendixPlacement !== undefined && {
                      appendixPlacement: fieldAppendixPlacement,
                    })}
                    {...(fieldDescription !== undefined && {
                      description: fieldDescription(field.field),
                    })}
                    allIssues={snapshot.errors}
                    valueDisplay={valueDisplay}
                    row={snapshot.values}
                    {...(disabled && { fillDisabled: true })}
                    {...(hideSectionTitles !== true &&
                      section.title !== undefined && { sectionTitle: section.title })}
                    {...((!isCreate || markChangedFields) &&
                      field.field in snapshot.changes && { changed: true })}
                  />
                ))}
              </Grid>
            );
            // Tabs mode: the tab panel is the surface, so field sections render
            // as unframed padded panels; group cards inside stay framed.
            // Stays `Card`, not `Section` — Section always flattens to a
            // borderless divider when rendered inside this component's own
            // `<Form>` (InsideFormContext), even with `chromeless` set, so it
            // cannot stand in for the tabs-mode card here.
            if (hideSectionTitles === true) {
              if (section.groups !== undefined) {
                const groupsGrid = (
                  <Grid key={`${sectionKey}-groups`} columns={1}>
                    {section.groups.map((group, groupIndex) => (
                      <Card
                        key={group.title}
                        slots={{ title: group.title }}
                        testId={`section-${sectionKey}-group-${groupIndex}`}
                      >
                        {renderFieldGrid(
                          group.fields,
                          group.columns,
                          `${sectionKey}-group-${groupIndex}-grid`,
                        )}
                      </Card>
                    ))}
                  </Grid>
                );
                // `actions` on a `groups` section has no group of its own to
                // sit in and would need an extra title-less Card around the
                // group cards (Card-in-Card) — the boot-validator rejects that
                // combination in tabs mode, so `sectionActionsEl` is always
                // undefined here at runtime.
                return wrapWizardStep(
                  sectionKey,
                  <Card key={sectionKey} options={{ framed: false }}>
                    {groupsGrid}
                  </Card>,
                );
              }
              // No section title here — the Tab strip right above
              // already names this panel, so a repeated Card title would just
              // duplicate it. The header row only exists to carry the section
              // description and actions, never the title text.
              const cardEl = (
                <Card
                  key={sectionKey}
                  options={{ framed: false }}
                  {...((sectionActionsEl !== undefined || section.description !== undefined) && {
                    slots: {
                      ...(section.description !== undefined && { subtitle: section.description }),
                      ...(sectionActionsEl !== undefined && { headerActions: sectionActionsEl }),
                    },
                  })}
                  testId={`section-${sectionKey}`}
                >
                  {renderFieldGrid(section.fields, section.columns, `${sectionKey}-grid`)}
                </Card>
              );
              return wrapWizardStep(sectionKey, cardEl);
            }
            // Suppress the section header when it would just repeat the form
            // title verbatim (typical for single-section actionForms), or the
            // tab label right above it. Without a Tabs primitive the sections
            // render stacked, and then the titles are what tells them apart.
            const repeatsTabLabel = isTabs && isStepped;
            const headerFallback = titleInSettingsHeader && sectionIndex === 0;
            const sectionTitle = headerFallback
              ? (section.title ?? formTitle)
              : section.title === formTitle || repeatsTabLabel
                ? undefined
                : section.title;
            const sectionSubtitle =
              section.description ?? (headerFallback ? formSubtitle : undefined);
            const sectionEl = (
              <Section
                key={sectionKey}
                {...(sectionNavItems.some((item) => item.id === formSectionDomId(sectionIndex)) && {
                  id: formSectionDomId(sectionIndex),
                })}
                {...(sectionTitle !== undefined && { title: sectionTitle })}
                {...(sectionSubtitle !== undefined && { subtitle: sectionSubtitle })}
                {...(section.icon !== undefined && { icon: section.icon })}
                {...(sectionActionsEl !== undefined && { actions: sectionActionsEl })}
                {...(isSettingsList && { layout: "settings-list" as const })}
                testId={`section-${sectionKey}`}
              >
                {showsAllRequiredHint && insideDrawer && sectionIndex === 0 && allRequiredHint}
                {renderFieldGrid(section.fields, section.columns, `${sectionKey}-grid`)}
              </Section>
            );
            return wrapWizardStep(sectionKey, sectionEl);
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
                      setExtraDeleteIssues([]);
                    }}
                    testId="render-edit-form-error-reload"
                  >
                    {translate("kumiko.actions.reload")}
                  </Button>
                ) : undefined
              }
            >
              <Text testId="render-edit-form-error-key">
                {translate(formError.i18nKey, formError.i18nParams)}
              </Text>
              {rootIssues.map((issue) => (
                <Text key={`${issue.path}:${issue.i18nKey}`} testId="render-edit-form-error-root">
                  {translate(issue.i18nKey, issue.params)}
                </Text>
              ))}
              {extraDeleteIssues.map((issue) => (
                <Text key={`${issue.path}:${issue.i18nKey}`} testId="render-edit-form-error-extra">
                  {translate(issue.i18nKey, issue.params)}
                </Text>
              ))}
            </Banner>
          )}
          {formError === null &&
            rootIssues.map((issue) => (
              <Banner variant="error" testId="render-edit-root-issue" key={issue.i18nKey}>
                <Text>{translate(issue.i18nKey, issue.params)}</Text>
              </Banner>
            ))}
          {extensionErrorKey !== null && (
            <Banner variant="error" testId="render-edit-extension-error">
              <Text testId="render-edit-extension-error-key">{translate(extensionErrorKey)}</Text>
            </Banner>
          )}
          {actionError !== null && (
            <Banner variant="error" testId="render-edit-action-error">
              {actionError.message}
              <ErrorReference requestId={actionError.requestId} />
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
                const rejection = await onDelete();
                // A rejected delete (e.g. a preDelete hook) carries its reason in
                // the field issues; the top-level key is only "validation failed".
                if (isDispatcherRejection(rejection)) {
                  const [issue, ...otherIssues] = rejection.details?.fields ?? [];
                  setExtraDeleteIssues(otherIssues);
                  setFormErrorSource("delete");
                  setFormError(
                    issue === undefined
                      ? rejection
                      : { ...rejection, i18nKey: issue.i18nKey, i18nParams: issue.params },
                  );
                }
              }}
              testId="render-edit-delete-dialog"
            />
          )}
        </AllFieldsRequiredProvider>
      </Form>
    </ExtensionFormRegistryProvider>
  );
}
