import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppFeatures } from "../app/app-features-context.tsx";
import { useClientActionRuntime } from "../app/client-actions.tsx";
import type { ErrorNotice } from "../app/error-reference.tsx";
import { useExtensionFormHost } from "../app/extension-form-submit.tsx";
import { useOptionalDispatcher } from "../context/dispatcher-context.tsx";
import { useDraftStorage } from "../context/draft-storage-context.tsx";
import { rendererWarn } from "../dev-console.ts";
import type { Dispatcher, DispatcherError, FieldIssue, Translate } from "../headless/index.ts";
import { useLocale, useTranslation } from "../i18n.tsx";
import { useInsideDrawer } from "../inside-drawer.ts";
import { usePageHeaderCompact, usePageHeaderSlotAvailable } from "../page-header-slot.ts";
import { usePrimitives } from "../primitives.tsx";
import { useFormPendingUploadsHost } from "./form-pending-uploads.tsx";
import type { FormErrorSource } from "./render-edit-helpers.tsx";
import {
  FIELD_APPROVAL_FEATURE,
  FIELD_APPROVAL_PENDING_CHANGES,
  type PendingApprovalRequest,
} from "./render-edit-logic.ts";
import { useActionMenuItems } from "./use-action-menu-items.tsx";
import { useWizardFormDraftState } from "./use-wizard-form-draft.ts";

function useSubmitFeedbackState() {
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
  return {
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    linkCopied,
    setLinkCopied,
    isSubmitting,
    setIsSubmitting,
    focusFirstErrorKey,
    setFocusFirstErrorKey,
    formError,
    setFormError,
    formErrorSource,
    setFormErrorSource,
    extraDeleteIssues,
    setExtraDeleteIssues,
    actionError,
    setActionError,
  };
}

function useStepState() {
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
  return {
    rawStep,
    setRawStep,
    passedStepKeys,
    setPassedStepKeys,
    extensionStepComplete,
    reportExtensionStepComplete,
    activeTabId,
    setActiveTabId,
  };
}

// Composed save: extension sections report their dirty state so the Save button
// activates when only a section changed, and provide a submit handler that runs
// after the entity write. extensionErrorKey stores the i18n key for a failed
// section persistence.
//
// This is not a second write path for saveDraft()'s data: deriveFormFields
// skips extension sections entirely, so extension-owned field state never enters
// `fields` or `controller.getSnapshot().values`; there is no draft-covered state
// left for persistExtensions() to compete over.
function useExtensionComposition() {
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
  return {
    extensionDirty,
    extensionDirtyRef,
    hasExtensionRegistrations,
    extensionErrorKey,
    setExtensionErrorKey,
    extensionFormRegistry,
    runExtensionSubmits,
  };
}

type PendingChangesAnswer = {
  readonly rows?: readonly {
    readonly id?: unknown;
    readonly version?: unknown;
    readonly fieldName?: unknown;
    readonly value?: unknown;
    readonly filedByCaller?: unknown;
  }[];
  readonly gatedFields?: readonly unknown[];
};

function toPendingApprovalRequests(
  rows: NonNullable<PendingChangesAnswer["rows"]>,
): readonly PendingApprovalRequest[] {
  return rows.flatMap((row) =>
    typeof row.fieldName === "string" &&
    typeof row.id === "string" &&
    typeof row.version === "number"
      ? [
          {
            id: row.id,
            version: row.version,
            fieldName: row.fieldName,
            filedByCaller: row.filedByCaller === true,
            ...(row.value !== undefined && { requestedValue: row.value }),
          },
        ]
      : [],
  );
}

type FieldApprovalAnswer = {
  readonly gatedFields: readonly string[];
  readonly requests: readonly PendingApprovalRequest[];
};

const NO_FIELD_APPROVAL: FieldApprovalAnswer = { gatedFields: [], requests: [] };

// The server knows which fields the caller must request (the client schema carries no access)
// and which requests are open, so the hint survives a reload and shows a request filed elsewhere.
function useFieldApproval(
  dispatcher: Dispatcher | undefined,
  entityType: string,
  entityId: string | null | undefined,
  enabled: boolean,
) {
  const [answer, setAnswer] = useState<FieldApprovalAnswer>(NO_FIELD_APPROVAL);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const savedEntityId = isCreateModeEntityId(entityId) ? null : entityId;
  const loadAnswer = useCallback(
    async (isSuperseded: () => boolean): Promise<void> => {
      // skip: no field-approval, or no server to ask
      if (!enabled || dispatcher === undefined) return;
      try {
        const result = await dispatcher.query<PendingChangesAnswer>(
          FIELD_APPROVAL_PENDING_CHANGES,
          { entityType, entityId: savedEntityId ?? null },
        );
        // skip: superseded, or the caller may not ask; the form then edits like without the feature
        if (isSuperseded() || !result.isSuccess) return;
        setAnswer({
          gatedFields: (result.data.gatedFields ?? []).filter(
            (name): name is string => typeof name === "string",
          ),
          requests: toPendingApprovalRequests(result.data.rows ?? []),
        });
      } catch (err: unknown) {
        rendererWarn("render-edit: field approval query failed", err);
      }
    },
    [dispatcher, entityType, savedEntityId, enabled],
  );
  const reload = useCallback(() => void loadAnswer(() => false), [loadAnswer]);
  useEffect(() => {
    let cancelled = false;
    void loadAnswer(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadAnswer]);
  return { ...answer, reload, drawerOpen, setDrawerOpen };
}

export function isCreateModeEntityId(entityId: string | null | undefined): boolean {
  return entityId === undefined || entityId === null || entityId === "";
}

export function useRenderEditState({
  screen,
  entityId,
  translate: translateProp,
  approvalEnabled,
}: {
  readonly screen: EntityEditScreenDefinition;
  readonly entityId: string | null | undefined;
  readonly translate: Translate | undefined;
  // Forms with their own submit (drawer, configEdit, projectionDetail) do not ask.
  readonly approvalEnabled: boolean;
}) {
  // Translate fallback: when the caller does not provide a translate function,
  // consume the i18next context directly. Otherwise field labels would remain raw
  // keys (`feature:entity:foo:field:title`) without caller wiring.
  // useTranslation throws without a LocaleProvider, which is acceptable because
  // RenderEdit only runs inside a mounted Kumiko app tree.
  const t = useTranslation();
  const appLocale = useLocale().locale();
  const translate = translateProp ?? t;
  const dispatcher = useOptionalDispatcher();
  const fieldApprovalMounted = useAppFeatures().some(
    (feature) => feature.featureName === FIELD_APPROVAL_FEATURE,
  );
  const notifyAction = useClientActionRuntime().notify;

  const isWizard = screen.layout.mode === "wizard";
  // Tabs reuse the wizard's step machinery: one section visible at a time,
  // all of them mounted, `currentStep` as the active index. What they do NOT
  // share is navigation — a tab form submits from any tab, so every
  // step-transition path below stays wizard-only.
  const isTabs = screen.layout.mode === "tabs";
  const draftEnabled = isWizard && screen.layout.draft === true && dispatcher !== undefined;
  const isCreateMode = isCreateModeEntityId(entityId);
  const draftStorage = useDraftStorage();
  const feedback = useSubmitFeedbackState();
  const fieldApproval = useFieldApproval(
    dispatcher,
    screen.entity,
    entityId,
    fieldApprovalMounted && approvalEnabled,
  );
  const stepState = useStepState();
  const draftState = useWizardFormDraftState({
    screenId: screen.id,
    entityId,
    isCreateMode,
    draftStorage,
  });
  const extensions = useExtensionComposition();
  const uploads = useFormPendingUploadsHost();
  const primitives = usePrimitives();
  const { toMenuItem: menuActionToItem, confirmDialog: menuActionConfirmDialog } =
    useActionMenuItems({ Dialog: primitives.Dialog, onError: feedback.setActionError });
  const pageHeaderSlotAvailable = usePageHeaderSlotAvailable();
  const pageHeaderCompact = usePageHeaderCompact();
  const insideDrawer = useInsideDrawer();

  // Both stepped layouts show one section at a time and keep the rest mounted but inert.
  const isStepped = isWizard || isTabs;
  return {
    translate,
    appLocale,
    dispatcher,
    fieldApproval,
    notifyAction,
    isWizard,
    isTabs,
    draftEnabled,
    isCreateMode,
    draftStorage,
    ...feedback,
    ...stepState,
    draftState,
    ...extensions,
    pendingUploads: uploads.pendingUploads,
    pendingUploadsRef: uploads.pendingUploadsRef,
    trackUpload: uploads.trackUpload,
    primitives,
    menuActionToItem,
    menuActionConfirmDialog,
    pageHeaderSlotAvailable,
    pageHeaderCompact,
    insideDrawer,
    isStepped,
  };
}

export type RenderEditState = ReturnType<typeof useRenderEditState>;
