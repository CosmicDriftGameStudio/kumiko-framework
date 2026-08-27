import type {
  EntityEditScreenDefinition,
  FieldCondition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import {
  evalFieldCondition,
  isFieldsEditSection,
  normalizeEditField,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type {
  DispatcherError,
  EditExtensionSectionViewModel,
  EditFieldViewModel,
  EditSectionViewModel,
  FieldConditions,
  FieldIssue,
  FormValues,
  SubmitResult,
} from "@cosmicdrift/kumiko-headless";
import { computeEditViewModel } from "@cosmicdrift/kumiko-headless";
import { RenderEditActionButton } from "./render-edit-action-button";
import type { RenderEditProps } from "./render-edit-types";

export type {
  RenderEditAction,
  RenderEditChangeState,
  RenderEditControls,
  RenderEditProps,
} from "./render-edit-types";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExtensionFormRegistryProvider, useExtensionFormHost } from "../app/extension-form-submit";
import { extensionSectionName, useExtensionSectionComponent } from "../app/extension-sections";
import { useOptionalDispatcher } from "../context/dispatcher-context";
import { useDraftStorage } from "../context/draft-storage-context";
import { formatWhen } from "../format-when";
import { useForm } from "../hooks/use-form";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import { RelatedListSection } from "./related-list-section";
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
const FORM_DRAFT_LIST = "form-draft:query:list";
// Mirrors bundled-features/src/form-draft/constants.ts's FORM_DRAFT_KEY_MAX_LENGTH
// — same hardcoding rationale as the QNs above (no dependency on that package).
const FORM_DRAFT_KEY_MAX_LENGTH = 256;

// Trailing-edge debounce for patch()-triggered draft saves (#1914). A single
// patch() call (VIN-decode, an extension section) should not save immediately
// per call, but patch() can also fire from inside onChange on every keystroke
// (the #1888 derived-field shape) — 500ms collapses a typing burst into one
// save instead of one per keystroke, while still saving well before a user
// abandons the tab.
export const PATCH_DRAFT_SAVE_DEBOUNCE_MS = 500;

type FormDraftBlob = {
  readonly values: Record<string, unknown>;
  readonly stepIndex: number;
};

type DraftCandidate = {
  readonly id: string;
  readonly draftKey: string;
  readonly stepIndex: number;
  readonly savedAt: string;
};

// draftKey convention for a create-mode draft (framework-wizard-mode.md,
// lookup.ts): `${screenId}:new:${draftId}`. Shared by the mount-time list
// fallback (strip the prefix to recover a candidate's draftId) and the
// list query itself (filter out edit-mode drafts, which share the same
// `${screenId}:%` LIKE-prefix scan server-side).
function newDraftPrefix(screenId: string): string {
  return `${screenId}:new:`;
}

// `crypto.randomUUID` is missing in non-secure contexts and React Native/Hermes
// without a polyfill — guard like dispatcher-live.ts's generateRequestId.
function mintDraftId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return `draft-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

// End-to-end renderer für einen entityEdit screen. Rendert aus-
// schließlich über Primitives — kein raw HTML. Ein Native-Renderer
// der dieselbe Primitives-Registry füllt kriegt das Form ohne weitere
// Änderungen.

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
    // relatedList carries no `fields` for the form-condition map either.
    if (!isFieldsEditSection(section)) continue;
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
    actions,
    submitLabel,
    labelAppendix,
    fieldAppendix,
    entityId: entityIdProp,
    extensionInitialValues,
    onChange,
    onControlsReady,
    fields: fieldsFilter,
    disabled = false,
    hideActions,
    valueDisplay = "form",
  } = props;
  const { customSubmit } = props;
  // Translate-Fallback: wenn der Caller keine Translate-Fn übergibt,
  // konsumieren wir den i18next-Context direkt. Sonst wären Field-
  // Labels ohne Caller-Wiring raw-Keys (`feature:entity:foo:field:title`).
  // useTranslation throwt ohne LocaleProvider — das ist ok, weil RenderEdit
  // ohnehin nur in einem mounted Kumiko-App-Tree läuft.
  const t = useTranslation();
  const translate = translateProp ?? t;
  const dispatcher = useOptionalDispatcher();

  const isWizard = screen.layout.mode === "wizard";
  const draftEnabled = isWizard && screen.layout.draft === true && dispatcher !== undefined;
  const isCreateMode = entityIdProp === undefined || entityIdProp === null || entityIdProp === "";
  const draftStorage = useDraftStorage();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<DispatcherError | null>(null);
  // One state for all header actions (actions?), not per-button — only one
  // action can be in flight at a time, and this keeps the error surfaced in
  // the shared formError-adjacent banner region instead of inside the
  // button row (fw#2166 review: a full-width Banner there breaks the
  // flex justify-end action bar).
  const [actionError, setActionError] = useState<string | null>(null);
  const [rawStep, setRawStep] = useState(0);
  // Create-mode draftId (issue #1913) — resumed from `sessionStorage` (web)
  // on mount so a same-tab reload finds the right one of several parallel
  // create-sessions on this screen; `null` until the first step change
  // mints one (saveDraft), or the mount-time `form-draft:query:list`
  // fallback below adopts an existing one. Edit-mode never touches this —
  // its draftKey is `${screen.id}:${entityIdProp}` unconditionally.
  const [draftId, setDraftId] = useState<string | null>(() =>
    isCreateMode ? draftStorage.getDraftId(screen.id) : null,
  );
  // Marks a draftId this instance minted itself (saveDraft, first step
  // change) so the restore effect below doesn't immediately re-fetch what
  // it just wrote — there is nothing to restore, the row is brand new.
  const mintedDraftIdRef = useRef<string | null>(null);
  // Marks that the mount-time `form-draft:query:list` fallback already ran
  // once for this mount. Without this, a create-mode discard resets `draftId`
  // to `null` (see discardDraft below) and would re-arm the list effect —
  // silently adopting an unrelated parallel draft on the same screen right
  // after the user just submitted (#1908).
  const didListRef = useRef(false);
  const [draftCandidates, setDraftCandidates] = useState<readonly DraftCandidate[] | null>(null);
  // Composed-Save: Extension-Sections melden hier ihren dirty-State (damit der
  // Save-Button aktiv wird wenn NUR eine Section geändert wurde) + ihren
  // Submit-Handler (läuft nach dem Entity-Write). extensionErrorKey hält den
  // i18n-Key einer fehlgeschlagenen Section-Persistierung.
  //
  // Not a second write path for saveDraft()'s data (#1914): deriveFormFields
  // (above) skips extension sections entirely, so extension-owned field state
  // never enters `fields`/`controller.getSnapshot().values` — there is no
  // draft-blob-covered state left for persistExtensions() to compete over.
  const [extensionDirty, setExtensionDirty] = useState(false);
  const [extensionErrorKey, setExtensionErrorKey] = useState<string | null>(null);
  const { registry: extensionFormRegistry, runAll: runExtensionSubmits } =
    useExtensionFormHost(setExtensionDirty);
  const {
    Button,
    Banner,
    Dialog,
    Form,
    Section,
    Grid,
    GridCell,
    Text,
    Progress,
    StepBar,
    WizardStepGroup,
  } = usePrimitives();

  const fields = useMemo(() => deriveFormFields<TValues, TCtx>(screen), [screen]);

  // Must be computed before submitConfig/useForm bakes it in (the controller
  // freezes it on first render). This is the unfiltered field-name set from
  // `fieldsFilter` ∩ `fields` — not the value-dependent `filteredSections`
  // (which also drops `section.visible === false`). Hidden fields still fall
  // out via form-controller's `hiddenFields` path. undefined = unscoped, since
  // scoping would silently drop root-level .refine() issues.
  // A `fieldsFilter` that matches nothing in `fields` (typo, renamed field)
  // must fall back to unscoped too — an empty scope array would filter out
  // ALL validation issues (kumiko-framework#1907), letting submit() through
  // unvalidated on a form that also renders no sections.
  const scopeFieldNames = useMemo(() => {
    if (fieldsFilter === undefined) return undefined;
    const matched = fieldsFilter.filter((f) => Object.hasOwn(fields, f));
    return matched.length === 0 ? undefined : matched;
  }, [fieldsFilter, fields]);

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
  // key, save under another). Edit-mode: `${screen.id}:${entityIdProp}`,
  // unchanged. Create-mode: `${screen.id}:new:${draftId}` once a draftId
  // exists (resumed, adopted, or minted), `undefined` before that — two
  // parallel create sessions on the same screen must never collapse onto
  // the same key (kumiko-framework#1908).
  const draftKey = useMemo(
    () =>
      isCreateMode
        ? draftId !== null
          ? `${screen.id}:new:${draftId}`
          : undefined
        : `${screen.id}:${entityIdProp}`,
    [screen.id, entityIdProp, isCreateMode, draftId],
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
  // Guards against redelivering to the SAME callback identity on every
  // render (an inline-arrow onControlsReady would otherwise refire the
  // effect below on every render since the callback itself is now a dep).
  // Tracks the actual prop, not a ref snapshot, so a caller that swaps in a
  // real handler after mount (e.g. `onControlsReady={ready ? cb : undefined}`)
  // gets delivered to for THIS mount instead of never (fw#1899).
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

  // `saveDraft` (defined below) is a fresh closure every render, over that
  // render's `draftKey`/`draftId` — the ref lets the debounce timer below
  // always call the CURRENT one even though the timer was scheduled by an
  // earlier render's patch() call. `currentStepRef` gives it the current
  // wizard step without depending on `currentStep` (computed further down,
  // from `filteredSections`) at the point patchAndScheduleDraftSave itself
  // is defined — kept fresh where `currentStep` is computed below.
  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;
  // `handleSubmit` (defined below) is a fresh closure over this render's
  // snapshot/extensionDirty, while the onControlsReady effect fires once per
  // mount — the ref lets controls.submit() always reach the current one.
  const handleSubmitRef = useRef<() => Promise<void>>(async () => {});
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
  // only the resulting draft save is debounced (#1914), so a patch() burst
  // (VIN-decode filling several fields, or onChange fanning a keystroke out
  // through patch(), see the #1888 test above) collapses into one save.
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
  // swap is otherwise a no-op. See the #1888 VIN-decode test: an initial
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
      submit: () => handleSubmitRef.current(),
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
    // call, e.g. from controls.validate() or submit()).
    const currentSchema = schemaRef.current;
    const valid =
      currentSchema === undefined ? true : currentSchema.safeParse(snapshot.values).success;
    cb({
      values: snapshot.values,
      changes: snapshot.changes,
      dirty: snapshot.isDirty,
      valid,
      submitting: isSubmitting,
    });
  }, [snapshot, isSubmitting]);

  useEffect(() => {
    // skip: this screen does not persist a draft.
    if (!draftEnabled || dispatcher === undefined) return;
    // skip: create-mode with no draftId yet — nothing to restore, either
    // the list-fallback effect below finds one or the first step change
    // mints a fresh one.
    if (draftKey === undefined) return;
    // skip: this draftId was just minted by saveDraft — the row it wrote
    // is exactly the current form state, re-fetching it would be a no-op
    // round-trip at best and a stale-echo clobber at worst.
    if (draftId !== null && draftId === mintedDraftIdRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
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
        // skip: the user already typed or wizard-navigated while the lookup
        // was in flight — their input wins over the stored draft.
        if (controller.getSnapshot().isDirty || hasNavigatedRef.current) return;
        // @cast-boundary form-draft blob: `values` round-trips through an opaque
        // jsonb column and comes back untyped.
        controller.setValues(draft.values as Partial<TValues>);
        setRawStep(Math.max(draft.stepIndex, 0));
      } catch (err: unknown) {
        // biome-ignore lint/suspicious/noConsole: draft restore must not red-screen the form
        console.warn("render-edit: draft restore query failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftEnabled, draftKey, draftId, dispatcher, controller]);

  // Mount-time fallback (issue #1913) for create-mode when no draftId
  // survived in storage (new tab, cleared storage): ask the server for this
  // screen's open drafts and let the user choose via a picker (below) —
  // even for exactly one candidate. Auto-adopting a lone candidate would
  // silently hand this tab someone else's in-progress draft from a parallel
  // session on the same screen (cross-tab hijack); the picker's "start new"
  // action covers the common case (it really was this tab's own draft) with
  // one extra click. Zero candidates → stay null, saveDraft mints a fresh
  // draftId on the first step change same as any other fresh create.
  useEffect(() => {
    // skip: this screen does not persist a draft, this is edit-mode, a
    // draftId is already known (from storage or an earlier adoption), or
    // this mount already ran the list lookup once (didListRef).
    if (
      !draftEnabled ||
      !isCreateMode ||
      draftId !== null ||
      didListRef.current ||
      dispatcher === undefined
    )
      return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await dispatcher.query<{ readonly drafts: readonly DraftCandidate[] }>(
          FORM_DRAFT_LIST,
          { screenId: screen.id },
        );
        // skip: superseded by a newer mount, or the lookup failed — an
        // unreachable draft store must not break a fresh create.
        if (cancelled || !result.isSuccess) return;
        didListRef.current = true;
        const prefix = newDraftPrefix(screen.id);
        // list's LIKE-prefix scan also matches edit-mode drafts
        // (`${screenId}:${entityId}`) — keep only create-mode ones.
        const candidates = (result.data?.drafts ?? []).filter((d) => d.draftKey.startsWith(prefix));
        // skip: no open drafts for this screen — stay null, saveDraft mints a
        // fresh draftId on the first step change same as any other create.
        if (candidates.length === 0) return;
        setDraftCandidates(candidates);
      } catch (err: unknown) {
        // biome-ignore lint/suspicious/noConsole: draft lookup must not red-screen the form
        console.warn("render-edit: draft list query failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftEnabled, isCreateMode, draftId, dispatcher, screen.id]);

  // User picked one of several open drafts from the mount-time picker
  // (see draftCandidates below) — adopt it the same way a single
  // auto-adopted candidate would be.
  function adoptDraft(candidate: DraftCandidate): void {
    // Locked state (#1896/fw#1909): `disabled` means "no write possible" —
    // repointing draftKey and patching in the candidate's values is exactly
    // that, so a locked form must not adopt a draft.
    if (disabled) return;
    const adoptedId = candidate.draftKey.slice(newDraftPrefix(screen.id).length);
    draftStorage.setDraftId(screen.id, adoptedId);
    setDraftId(adoptedId);
    setDraftCandidates(null);
  }

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
    // A fully-hidden "fields" section (every field in it currently
    // condition-hidden) must not occupy a wizard step; it would render
    // empty and block Back/Next on nothing. Extension and relatedList
    // sections carry no `visible` (they own their own lifecycle / run
    // their own query), so they always pass through. A section with no
    // fields at all (e.g. a review-only step) has `visible: fields.some(...)`
    // = false vacuously; that's "no fields to hide", not "hidden", so it
    // stays too (fw#1901).
    () =>
      filterEditSections(vm.sections, fieldsFilter).filter(
        (section) =>
          section.kind === "extension" ||
          section.kind === "relatedList" ||
          section.fields.length === 0 ||
          section.visible,
      ),
    [vm.sections, fieldsFilter],
  );

  // true when editable fields exist or an extension opted into composed submit (fw#2359).
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
  // Kept fresh for patchAndScheduleDraftSave's debounce timer above, which
  // is defined before `currentStep` exists (it depends on `filteredSections`,
  // computed further up from `vm`) and so cannot close over it directly.
  currentStepRef.current = currentStep;
  const isLastWizardStep = currentStep >= lastStepIndex;

  // Step transitions only — never per keystroke. Deliberately not awaited: a
  // failed draft save must not block the step change.
  //
  // Create-mode, first draft save (step change OR a debounced patch() from
  // controlled mode / extension sections, see patchAndScheduleDraftSave
  // above — both call this on step 0 too): mints the draftId here (issue
  // #1913) rather than at mount, so a form nobody ever interacted with
  // never claims a draftId or writes a row. `draftKey`/`draftId` state
  // won't reflect the mint until the next render, so the just-minted key is
  // computed inline instead of read from the memoized `draftKey`.
  function saveDraft(stepIndex: number): void {
    // skip: this screen does not persist a draft.
    if (!draftEnabled || dispatcher === undefined) return;
    let key = draftKey;
    if (isCreateMode && draftId === null) {
      const mintedId = mintDraftId();
      mintedDraftIdRef.current = mintedId;
      draftStorage.setDraftId(screen.id, mintedId);
      setDraftId(mintedId);
      key = `${screen.id}:new:${mintedId}`;
      // A stale picker from the mount-time list fallback must not survive a
      // mint — picking a candidate afterwards would repoint draftKey at an
      // unrelated draft mid-edit and overwrite it (#1908).
      setDraftCandidates(null);
    }
    // skip: create-mode with a draftId that failed to mint — unreachable
    // in practice (mint above always produces one), kept as a type-level
    // guard against a stale `undefined` key ever reaching the write.
    if (key === undefined) return;
    // draftKeySchema.max(FORM_DRAFT_KEY_MAX_LENGTH) rejects this server-side —
    // catch it here instead of losing the save silently to the fire-and-forget
    // write below (the user would only notice on resume, with nothing to resume).
    if (key.length > FORM_DRAFT_KEY_MAX_LENGTH) {
      // biome-ignore lint/suspicious/noConsole: no error-surfacing path exists for a fire-and-forget draft save.
      console.warn(
        `RenderEdit: draftKey "${key}" is ${key.length} chars, over the server's ${FORM_DRAFT_KEY_MAX_LENGTH}-char limit — skipping this draft save. Shorten screen.id or entity id.`,
      );
      return;
    }
    void dispatcher
      .write(FORM_DRAFT_SAVE, {
        draftKey: key,
        values: controller.getSnapshot().values,
        stepIndex,
      })
      .catch((err: unknown) => {
        // biome-ignore lint/suspicious/noConsole: fire-and-forget draft save must not red-screen
        console.warn("render-edit: draft save failed", err);
      });
  }

  // Next: scoped validate() on the current step's fields — errors stay
  // attached to the field and block the step transition. Extension steps
  // have no field scope here (they validate via the controlled-mode
  // controls.validate() API), so no call, no clearing of unrelated errors.
  function handleWizardNext(): void {
    const next = Math.min(currentStep + 1, lastStepIndex);
    hasNavigatedRef.current = true;
    // Locked state (#1896): `disabled` means "no input/no write", not "no
    // navigation" — a disabled wizard must still be steppable so Back/Next
    // reach every step. But neither validate() (would block on an empty
    // required field nobody can fill in) nor saveDraft() (would mint a
    // draftId / dispatch a write — exactly what `disabled` forbids) may run.
    if (disabled) {
      setRawStep(next);
      return;
    }
    const section = filteredSections[currentStep];
    const fieldNames = section?.kind === "fields" ? section.fields.map((f) => f.field) : [];
    // skip: the current step has field errors — no transition, no draft save.
    if (fieldNames.length > 0 && !controller.validate(fieldNames)) return;
    setRawStep(next);
    saveDraft(next);
  }

  function handleWizardBack(): void {
    const previous = Math.max(currentStep - 1, 0);
    hasNavigatedRef.current = true;
    if (disabled) {
      setRawStep(previous);
      return;
    }
    setRawStep(previous);
    saveDraft(previous);
  }

  async function discardDraft(): Promise<void> {
    // skip: this screen does not persist a draft.
    if (!draftEnabled || dispatcher === undefined) return;
    // A pending debounced patch-save must not fire after discard — it would
    // resurrect the draft it just deleted.
    if (draftSaveTimerRef.current !== null) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    // skip: create-mode, no step change happened yet — no draftId was ever
    // minted, so no row exists to discard.
    if (draftKey === undefined) return;
    // Best-effort: a rejected write (e.g. network error) must not propagate
    // out of handleSubmit AFTER the entity write already succeeded — that
    // would break onSubmit/navigation/toast and risk a duplicate submit on
    // retry. An orphaned draft row is swept later by cleanup.job.ts. Local
    // cleanup below still runs on failure so this instance doesn't try to
    // resume a draft it already considers submitted.
    try {
      await dispatcher.write(FORM_DRAFT_DISCARD, { draftKey });
    } catch {
      // best-effort, see comment above.
    }
    // A successful submit ends this draftId's life — a subsequent create on
    // the same screen (new mount) must mint its own, not resume this one.
    if (isCreateMode) {
      draftStorage.clearDraftId(screen.id);
      mintedDraftIdRef.current = null;
      setDraftId(null);
    }
  }

  // Wizard mode: locates the first step whose "fields" section contains one
  // of the given field paths — matched on the path's first segment, since
  // `FieldIssue.path`/`snapshot.errors` keys can be dotted (embedded-list
  // rows, e.g. `tasks.2.title`) while a section's field name is always the
  // plain top-level name. Returns undefined for a root-level issue (path
  // `"(root)"`, see zod-bridge.ts) or one that matches no rendered field —
  // callers must NOT suppress the error banner in that case, there is
  // nowhere to jump the user to.
  function findFirstErroringStep(fieldPaths: readonly string[]): number | undefined {
    const erroredFields = new Set(fieldPaths.map((p) => p.split(".")[0]));
    const idx = filteredSections.findIndex(
      (s) => s.kind === "fields" && s.fields.some((f) => erroredFields.has(f.field)),
    );
    return idx === -1 ? undefined : idx;
  }

  async function handleSubmit(): Promise<void> {
    // Enter in the active step triggers the native form submit (Next is
    // type="submit" for Enter support) — on intermediate steps that means
    // "Next", not "Save". Checked BEFORE the `disabled` guard below:
    // `disabled` means "no input/no write", not "no navigation" — a
    // disabled wizard must still be steppable (handleWizardNext itself
    // blocks validate()/saveDraft() while disabled).
    if (isWizard && !isLastWizardStep) {
      handleWizardNext();
      return;
    }
    // Locked state (#1896): the submit button is visibly disabled, but a
    // native form submit (Enter key) reaches this handler regardless of the
    // button's disabled attribute — block it here too, not just in the UI.
    if (disabled) return;
    // Sync guard — React state `isSubmitting` is too late for double-clicks
    // in the same tick (customSubmit has no submitInFlight of its own).
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setExtensionErrorKey(null);
    try {
      // Extension-only: only a section is dirty, the main form is unchanged.
      // No entity write (would send an empty changes payload) — only
      // die Section-Handler laufen lassen.
      if (snapshot.isUnchanged && extensionDirty) {
        // Same discard as the main path: an extension-only save is still a
        // successful submit, so the draft must not survive it.
        if (await persistExtensions()) {
          submittedRef.current = true;
          await discardDraft();
        }
        return;
      }
      let result: SubmitResult<unknown>;
      if (customSubmit !== undefined) {
        // customSubmit path (e.g. configEdit, which fires a separate write
        // per field). Client-side validation first, then
        // an den Caller; on-success rebased der Form-State explizit
        // because controller.submit() normally does this itself and
        // without customSubmit's help the controller knows nothing about
        // erfolgreichen Submit (isUnchanged blieb sonst false).
        //
        // WICHTIG: snapshot direkt vom Controller holen statt aus
        // React state. On rapid fill→click, React batching may not have
        // committed input state updates yet when the submit click fires.
        // handleSubmit's closure would then run with
        // stale snapshot.changes={} laufen, customSubmit fired keine
        // Writes, returnt success, Form rebase → User glaubt "saved"
        // aber gar nichts ist passiert. controller.getSnapshot() ist
        // immer aktuell — der Controller ist die Source-of-Truth, die
        // React state is only a mirror for rendering.
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
        // `isNoOp: true` (payloadMode "changes", pre-filled form submitted
        // untouched) means controller.submit() never called dispatcher.write
        // — nothing to discard, and discarding here would delete a draft the
        // form never persisted (fw#1978). Awaited, not fire-and-forget:
        // `onSubmit` typically navigates away and unmounts this form, which
        // would abort an in-flight discard and leave the draft behind after
        // a successful submit.
        if (result.isNoOp !== true) {
          submittedRef.current = true;
          await discardDraft();
        }
        extensionsPersisted = await persistExtensions();
      } else if (result.validationBlocked) {
        // Root-level `.refine()`/cross-field issues from controller.validate()
        // — same "jump to the erroring step" treatment as a server field
        // error below, sourced from the freshly-validated snapshot.
        if (isWizard) {
          const step = findFirstErroringStep(Object.keys(controller.getSnapshot().errors));
          if (step !== undefined) setRawStep(step);
        }
      } else {
        const fieldIssues = result.error.details?.fields ?? [];
        // A server field error on a step the wizard isn't currently showing
        // is otherwise invisible — jump to the first step that contains one
        // of the errored fields. Non-wizard forms render every field at
        // once, so the original suppress-when-field-issues-exist rule still
        // applies there (the field itself already shows the error inline).
        if (isWizard) {
          const step = findFirstErroringStep(fieldIssues.map((i) => i.path));
          if (step !== undefined) {
            setRawStep(step);
            setFormError(null);
          } else {
            // No rendered step contains any of the errored fields (a
            // root-level issue, or a field outside every step) — nothing
            // will show this error inline, so the banner must not be
            // suppressed.
            setFormError(result.error);
          }
        } else {
          setFormError(fieldIssues.length === 0 ? result.error : null);
        }
      }
      // skip: on entity-success-but-extension-failure the extension-error
      // banner is showing — don't notify (the caller navigates away on success
      // and would unmount it before the user sees the failure).
      if (shouldNotifyCaller(result, extensionsPersisted)) onSubmit?.(result);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }
  handleSubmitRef.current = handleSubmit;

  // Sticky-top Action-Bar: Delete (links, destructive) + Cancel +
  // Save. Delete sitzt links abgesetzt damit die Click-Distanz zu
  // Save is large; red styling + confirm dialog are enough protection
  // gegen Fehlklicks. Save bleibt rechts (primary affordance).
  const formActions = (
    <>
      {actions?.map((action) => (
        <RenderEditActionButton
          key={action.id}
          action={action}
          Button={Button}
          Dialog={Dialog}
          onError={setActionError}
        />
      ))}
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
          disabled={disabled}
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
        <Button type="submit" variant="primary" testId="render-edit-wizard-next">
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
  // title falls back to screenId; subtitle to undefined (no subtitle).
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
        {...(hideActions !== true && { actions: formActions })}
        testId="render-edit-form"
        stickyActions={isWizard}
        {...(screen.layout.width !== undefined && { width: screen.layout.width })}
      >
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
        {isWizard && (
          <>
            {Progress !== undefined && (
              <Progress
                value={(currentStep + 1) / (lastStepIndex + 1)}
                testId="render-edit-wizard-progress"
              />
            )}
            {(() => {
              const currentTitle = filteredSections[currentStep]?.title;
              const compactLabel =
                currentTitle !== undefined
                  ? translate("kumiko.wizard.step-with-title", {
                      current: currentStep + 1,
                      total: lastStepIndex + 1,
                      title: currentTitle,
                    })
                  : translate("kumiko.wizard.step", {
                      current: currentStep + 1,
                      total: lastStepIndex + 1,
                    });
              // No StepBar registered → keep the plain label RenderEdit
              // always had (additive rollout, see CorePrimitives.StepBar).
              if (StepBar === undefined) {
                return (
                  <Text variant="small" testId="render-edit-wizard-step-label">
                    {compactLabel}
                  </Text>
                );
              }
              return (
                <StepBar
                  steps={filteredSections.map((section) => section.title ?? "")}
                  currentIndex={currentStep}
                  compactLabel={compactLabel}
                  testId="render-edit-wizard-steps"
                  compactTestId="render-edit-wizard-step-label"
                />
              );
            })()}
          </>
        )}
        {filteredSections.map((section: EditSectionViewModel, sectionIndex: number) => {
          // Wizard steps stay mounted while off-screen (native `hidden`, not
          // unmounted) so an extension section's submit-registry entry
          // (useExtensionFormSubmit → registry.remove on unmount) survives
          // navigating past its step — otherwise Finish only ran the last
          // mounted step's handler and silently dropped earlier steps' writes.
          const stepHidden = isWizard && sectionIndex !== currentStep;
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
                  patchAndScheduleDraftSave as (partial: Readonly<Record<string, unknown>>) => void
                }
                validate={scopedValidate}
              />
            );
            if (!isWizard) return mount;
            if (WizardStepGroup === undefined) {
              // Both silent fallbacks are unsafe here — render-visible-all-steps or unmount-drops-registry.
              throw new Error(
                "RenderEdit: wizard layout requires primitives.WizardStepGroup, but none is registered.",
              );
            }
            return (
              <WizardStepGroup key={section.title} hidden={stepHidden}>
                {mount}
              </WizardStepGroup>
            );
          }
          if (section.kind === "relatedList") {
            // parentId is the displayed record's id — without it there's no
            // parent row whose related rows could be queried (fw#2166).
            // Rejected at boot in wizard layouts, so no WizardStepGroup here.
            const parentId = resolveExtensionEntityId(entityIdProp, vm.id);
            if (parentId === null) return null;
            return (
              <RelatedListSection
                key={section.title}
                section={section}
                parentId={parentId}
                featureName={featureName}
                translate={translate}
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
          const sectionEl = (
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
                    valueDisplay={valueDisplay}
                    row={snapshot.values}
                  />
                ))}
              </Grid>
            </Section>
          );
          if (!isWizard) return sectionEl;
          if (WizardStepGroup === undefined) {
            throw new Error(
              "RenderEdit: wizard layout requires primitives.WizardStepGroup, but none is registered.",
            );
          }
          return (
            <WizardStepGroup key={sectionKey} hidden={stepHidden}>
              {sectionEl}
            </WizardStepGroup>
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
        {actionError !== null && (
          <Banner variant="error" testId="render-edit-action-error">
            {actionError}
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
  /** Passed through to RenderField unchanged — see RenderEditProps.valueDisplay. */
  readonly valueDisplay: "form" | "text";
  /** Passed through to RenderField as `row` — see RenderFieldProps.row. */
  readonly row: Readonly<Record<string, unknown>>;
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
  valueDisplay,
  row,
}: GridCellForFieldProps): ReactNode {
  // RenderField renders nothing for a hidden field, but the GridCell around it still claims the row.
  if (!field.visible) return null;

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
        valueDisplay={valueDisplay}
        row={row}
      />
    </GridCell>
  );
}
