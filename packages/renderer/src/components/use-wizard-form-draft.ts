import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import type { DraftStorage } from "../context/draft-storage-context.tsx";
import { rendererWarn } from "../dev-console.ts";
import type {
  Dispatcher,
  EditSectionViewModel,
  FormController,
  FormValues,
} from "../headless/index.ts";

// Qualified names of the bundled `form-draft` feature. Hardcoded because the
// renderer must not depend on @cosmicdrift/kumiko-bundled-features; a screen
// with `layout.draft: true` and that feature unmounted is a boot error, so
// these can never dangle silently.
const FORM_DRAFT_GET = "form-draft:query:get";

const FORM_DRAFT_SAVE = "form-draft:write:save";

const FORM_DRAFT_DISCARD = "form-draft:write:discard";

const FORM_DRAFT_LIST = "form-draft:query:list";

// Mirrors bundled-features/src/form-draft/web/constants.ts's FORM_DRAFT_KEY_MAX_LENGTH
// — same hardcoding rationale as the QNs above (no dependency on that package).
const FORM_DRAFT_KEY_MAX_LENGTH = 256;

// Trailing-edge debounce for patch()-triggered draft saves. A single
// patch() call (VIN-decode, an extension section) should not save immediately
// per call, but patch() can also fire from inside onChange on every keystroke
// (the derived-field shape) — 500ms collapses a typing burst into one
// save instead of one per keystroke, while still saving well before a user
// abandons the tab.
export const PATCH_DRAFT_SAVE_DEBOUNCE_MS = 500;

type FormDraftBlob = {
  readonly values: Record<string, unknown>;
  readonly stepIndex: number;
};

export type DraftCandidate = {
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
// without a polyfill — guard like generateRequestId in headless/dispatcher/request-id.ts.
function mintDraftId(): string {
  const webCrypto = propertyOf(globalThis, "crypto");
  const randomUUID = propertyOf(webCrypto, "randomUUID");
  if (typeof randomUUID === "function") {
    const id: unknown = Reflect.apply(randomUUID, webCrypto, []);
    if (typeof id === "string") return id;
  }
  return `draft-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export function useWizardFormDraftState({
  screenId,
  entityId,
  isCreateMode,
  draftStorage,
}: {
  readonly screenId: string;
  readonly entityId: string | null | undefined;
  readonly isCreateMode: boolean;
  readonly draftStorage: DraftStorage;
}) {
  // Create-mode draftId — resumed from `sessionStorage` (web)
  // on mount so a same-tab reload finds the right one of several parallel
  // create-sessions on this screen; `null` until the first step change
  // mints one (saveDraft), or the mount-time `form-draft:query:list`
  // fallback below adopts an existing one. Edit-mode never touches this —
  // its draftKey is `${screenId}:${entityId}` unconditionally.
  const [draftId, setDraftId] = useState<string | null>(() =>
    isCreateMode ? draftStorage.getDraftId(screenId) : null,
  );
  // Marks a draftId this instance minted itself (saveDraft, first step
  // change) so the restore effect below doesn't immediately re-fetch what
  // it just wrote — there is nothing to restore, the row is brand new.
  const mintedDraftIdRef = useRef<string | null>(null);
  // Marks that the mount-time `form-draft:query:list` fallback already ran
  // once for this mount. Without this, a create-mode discard resets `draftId`
  // to `null` (see discardDraft below) and would re-arm the list effect —
  // silently adopting an unrelated parallel draft on the same screen right
  // after the user just submitted.
  const didListRef = useRef(false);
  const [draftCandidates, setDraftCandidates] = useState<readonly DraftCandidate[] | null>(null);

  // Derived from the screen id + the host entity id only — never from
  // `vm.id`, which lives in the form values a restore mutates (load under one
  // key, save under another). Edit-mode: `${screenId}:${entityId}`,
  // unchanged. Create-mode: `${screenId}:new:${draftId}` once a draftId
  // exists (resumed, adopted, or minted), `undefined` before that — two
  // parallel create sessions on the same screen must never collapse onto
  // the same key.
  const draftKey = useMemo(
    () =>
      isCreateMode
        ? draftId !== null
          ? `${screenId}:new:${draftId}`
          : undefined
        : `${screenId}:${entityId}`,
    [screenId, entityId, isCreateMode, draftId],
  );

  return {
    draftId,
    setDraftId,
    draftCandidates,
    setDraftCandidates,
    mintedDraftIdRef,
    didListRef,
    draftKey,
  };
}

export type WizardFormDraftState = ReturnType<typeof useWizardFormDraftState>;

export function useWizardFormDraftRestore<TValues extends FormValues>({
  screenId,
  isCreateMode,
  draftEnabled,
  dispatcher,
  controller,
  hasNavigatedRef,
  setRawStep,
  draftState: { draftId, draftKey, mintedDraftIdRef, didListRef, setDraftCandidates },
}: {
  readonly screenId: string;
  readonly isCreateMode: boolean;
  readonly draftEnabled: boolean;
  readonly dispatcher: Dispatcher | undefined;
  readonly controller: FormController<TValues>;
  readonly hasNavigatedRef: MutableRefObject<boolean>;
  readonly setRawStep: (step: number) => void;
  readonly draftState: WizardFormDraftState;
}): void {
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
        // @cast-boundary form-values draft blob: `values` round-trips through an opaque
        // jsonb column and comes back untyped.
        controller.setValues(draft.values as Partial<TValues>);
        setRawStep(Math.max(draft.stepIndex, 0));
      } catch (err: unknown) {
        rendererWarn("render-edit: draft restore query failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    draftEnabled,
    draftKey,
    draftId,
    dispatcher,
    controller,
    mintedDraftIdRef,
    hasNavigatedRef,
    setRawStep,
  ]);

  // Mount-time fallback for create-mode when no draftId
  // survived in storage (new tab, cleared storage): ask the server for this
  // screen's open drafts and let the user choose via a picker (below) —
  // even for exactly one candidate. Auto-adopting a lone candidate would
  // silently hand this tab someone else's in-progress draft from a parallel
  // session on the same screen (cross-tab hijack); the picker's "start new"
  // action covers the common case (it really was this tab's own draft) with
  // one extra click. Zero candidates → stay null, saveDraft mints a fresh
  // draftId on the first step change same as any other fresh create.
  useEffect(() => {
    if (
      !draftEnabled ||
      !isCreateMode ||
      draftId !== null ||
      didListRef.current ||
      dispatcher === undefined
    ) {
      // skip: this screen does not persist a draft, this is edit-mode, a
      // draftId is already known (from storage or an earlier adoption), or
      // this mount already ran the list lookup once (didListRef).
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await dispatcher.query<{ readonly drafts: readonly DraftCandidate[] }>(
          FORM_DRAFT_LIST,
          { screenId: screenId },
        );
        // skip: superseded by a newer mount, or the lookup failed — an
        // unreachable draft store must not break a fresh create.
        if (cancelled || !result.isSuccess) return;
        didListRef.current = true;
        const prefix = newDraftPrefix(screenId);
        // list's LIKE-prefix scan also matches edit-mode drafts
        // (`${screenId}:${entityId}`) — keep only create-mode ones.
        const candidates = (result.data?.drafts ?? []).filter((d) => d.draftKey.startsWith(prefix));
        // skip: no open drafts for this screen — stay null, saveDraft mints a
        // fresh draftId on the first step change same as any other create.
        if (candidates.length === 0) return;
        setDraftCandidates(candidates);
      } catch (err: unknown) {
        rendererWarn("render-edit: draft list query failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftEnabled, isCreateMode, draftId, dispatcher, screenId, didListRef, setDraftCandidates]);
}

export function buildWizardDraftActions<TValues extends FormValues>({
  screenId,
  isCreateMode,
  draftEnabled,
  disabled,
  dispatcher,
  draftStorage,
  controller,
  sections,
  draftSaveTimerRef,
  draftState: { draftId, draftKey, mintedDraftIdRef, setDraftId, setDraftCandidates },
}: {
  readonly screenId: string;
  readonly isCreateMode: boolean;
  readonly draftEnabled: boolean;
  readonly disabled: boolean;
  readonly dispatcher: Dispatcher | undefined;
  readonly draftStorage: DraftStorage;
  readonly controller: FormController<TValues>;
  readonly sections: readonly EditSectionViewModel[];
  readonly draftSaveTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  readonly draftState: WizardFormDraftState;
}) {
  // User picked one of several open drafts from the mount-time picker
  // (see draftCandidates below) — adopt it the same way a single
  // auto-adopted candidate would be.
  function adoptDraft(candidate: DraftCandidate): void {
    // Locked state: `disabled` means "no write possible" —
    // repointing draftKey and patching in the candidate's values is exactly
    // that, so a locked form must not adopt a draft.
    // skip: a locked form keeps its current draft (reason above).
    if (disabled) return;
    const adoptedId = candidate.draftKey.slice(newDraftPrefix(screenId).length);
    draftStorage.setDraftId(screenId, adoptedId);
    setDraftId(adoptedId);
    setDraftCandidates(null);
  }

  // Step transitions only — never per keystroke. Deliberately not awaited: a
  // failed draft save must not block the step change.
  //
  // Create-mode, first draft save (step change OR a debounced patch() from
  // controlled mode / extension sections, see patchAndScheduleDraftSave
  // above — both call this on step 0 too): mints the draftId here
  // rather than at mount, so a form nobody ever interacted with
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
      draftStorage.setDraftId(screenId, mintedId);
      setDraftId(mintedId);
      key = `${screenId}:new:${mintedId}`;
      // A stale picker from the mount-time list fallback must not survive a
      // mint — picking a candidate afterwards would repoint draftKey at an
      // unrelated draft mid-edit and overwrite it.
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
      rendererWarn(
        `RenderEdit: draftKey "${key}" is ${key.length} chars, over the server's ${FORM_DRAFT_KEY_MAX_LENGTH}-char limit — skipping this draft save. Shorten screenId or entity id.`,
      );
      // skip: warned above, the oversized key would be rejected by the server anyway.
      return;
    }
    const secretFieldNames = new Set(
      sections.flatMap((section) =>
        section.kind === "fields"
          ? section.fields
              .filter(
                (f) => f.format === "password" || f.writeOnly === true || f.sensitive === true,
              )
              .map((f) => f.field)
          : [],
      ),
    );
    // A password, writeOnly or sensitive field never enters the persisted draft blob — it would be stored in the clear and restored on resume.
    const draftValues = Object.fromEntries(
      Object.entries(controller.getSnapshot().values).filter(
        ([field]) => !secretFieldNames.has(field),
      ),
    );
    void dispatcher
      .write(FORM_DRAFT_SAVE, {
        draftKey: key,
        values: draftValues,
        stepIndex,
      })
      .catch((err: unknown) => {
        rendererWarn("render-edit: draft save failed", err);
      });
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
      draftStorage.clearDraftId(screenId);
      mintedDraftIdRef.current = null;
      setDraftId(null);
    }
  }

  return { adoptDraft, saveDraft, discardDraft };
}
