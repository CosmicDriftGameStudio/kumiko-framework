import type {
  ActionFormScreenDefinition,
  RowActionDrawer,
  ToolbarAction,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withDerivedValues } from "../components/form-derivation-patch.ts";
import { RenderEdit } from "../components/render-edit.tsx";
import { useDispatcher } from "../context/dispatcher-context.tsx";
import type { FormValues, SubmitResult, Translate } from "../headless/index.ts";
import { useLocale, useTranslation } from "../i18n.tsx";
import { InsideDrawerProvider, useInsideDrawer } from "../inside-drawer.ts";
import { PageHeaderSlotAvailableProvider } from "../page-header-slot.ts";
import { usePrimitives } from "../primitives.tsx";
import { screenFillsHeight } from "../screen-fills-height.ts";
import {
  actionFormSubmittableFields,
  synthesizeActionFormEntity,
  synthesizeActionFormScreen,
} from "./action-form-shim.ts";
import {
  ActionFormLoadStatus,
  ActionFormSuccessBanner,
  type ActionFormSuccessState,
  isSecretFormField,
  resolveActionFormRecordId,
  resolveSuccessFacts,
  useActionFormLoad,
} from "./action-form-support.tsx";
import { useAppFeatures } from "./app-features-context.tsx";
import {
  mergeSearchParamsIntoInitial,
  tenantCurrencyMoneyFieldNames,
  useMoneyCurrencyOverrides,
} from "./entity-edit-prefill.ts";
import type { FeatureSchema } from "./feature-schema.ts";
import { hiddenRequiredFieldsFilled, layoutFieldNames } from "./layout-fields.ts";
import { useInitialValuesHandoff, useNav } from "./nav.tsx";
import { lastSegment } from "./qn.ts";
import { qualifyScreenId } from "./qualify-screen-id.ts";
import { QueryLoadingBanner } from "./query-state-banners.tsx";
import { navigateToReturn, navigateToReturnOr, useReturnTarget } from "./return-to.tsx";
import { screenAccessAllows } from "./screen-access.ts";
import {
  formatSummaryParams,
  navigateToRedirectTarget,
  redirectScreenTarget,
  resolveActionFormSummary,
  resolveRedirectTarget,
  resolveSuccessLinks,
  resolveSuccessMessageParams,
  returnToWinsOverRedirect,
  ScreenAccessDeniedBanner,
  ScreenMissingState,
} from "./screen-shared.tsx";

// ---- drawer-kind actions: ToolbarAction (fw#2225) + RowAction (fw#2710) ----
//
// Shared across EntityListBody, ProjectionListBody, ProjectionDetailBody and
// EntityEditUpdateForm: state for "which drawer-kind action is currently
// open" plus a host component that mounts the referenced actionForm inside
// the Drawer primitive. Reuses ActionFormBody (no second, parallel form
// renderer) with onSuccess/onCancelOverride so submit-success closes the
// drawer + refetches the host screen instead of navigating, mirroring what
// a full-page actionForm would do via `redirect`. The only difference
// between the toolbar and row variants is prefill: a row action extracts
// `initialValues` from the clicked row (see buildProjectionRowActions /
// EntityListBody's rowActions builder); the toolbar variant has none.
type DrawerLikeAction = Extract<ToolbarAction, { kind: "drawer" }> | RowActionDrawer;

export function useDrawerAction(schema: FeatureSchema): {
  readonly drawerAction: DrawerLikeAction | null;
  readonly drawerScreen: ActionFormScreenDefinition | undefined;
  readonly drawerInitialValues: Readonly<Record<string, unknown>> | undefined;
  readonly openDrawer: (
    action: DrawerLikeAction,
    initialValues?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly closeDrawer: () => void;
} {
  const [drawerState, setDrawerState] = useState<{
    readonly action: DrawerLikeAction;
    readonly initialValues: Readonly<Record<string, unknown>> | undefined;
  } | null>(null);
  const drawerAction = drawerState?.action ?? null;
  const drawerScreen = useMemo(() => {
    if (drawerAction === null) return undefined;
    // Same same-feature, short-id resolution as runNavigate — the drawer's
    // `screen` reference is scoped to schema.screens, not cross-feature.
    return schema.screens.find(
      (s): s is ActionFormScreenDefinition =>
        s.type === "actionForm" && lastSegment(s.id) === drawerAction.screen,
    );
  }, [drawerAction, schema.screens]);
  const openDrawer = useCallback(
    (action: DrawerLikeAction, initialValues?: Readonly<Record<string, unknown>>) =>
      setDrawerState({ action, initialValues }),
    [],
  );
  const closeDrawer = useCallback(() => setDrawerState(null), []);
  return {
    drawerAction,
    drawerScreen,
    drawerInitialValues: drawerState?.initialValues,
    openDrawer,
    closeDrawer,
  };
}

export function DrawerHost({
  schema,
  drawerAction,
  drawerScreen,
  drawerInitialValues,
  userRoles,
  translate,
  onClose,
  onSuccess,
}: {
  readonly schema: FeatureSchema;
  readonly drawerAction: DrawerLikeAction | null;
  readonly drawerScreen: ActionFormScreenDefinition | undefined;
  readonly drawerInitialValues?: Readonly<Record<string, unknown>>;
  readonly userRoles: readonly string[] | undefined;
  readonly translate?: Translate;
  readonly onClose: () => void;
  readonly onSuccess: () => void;
}): ReactNode {
  const { Drawer, Dialog } = usePrimitives();
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const locale = useLocale().locale();
  const [hasUnsavedInput, setHasUnsavedInput] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const closeAndReset = useCallback(() => {
    setHasUnsavedInput(false);
    setConfirmDiscardOpen(false);
    onClose();
  }, [onClose]);
  const requestClose = useCallback(() => {
    if (hasUnsavedInput) setConfirmDiscardOpen(true);
    else closeAndReset();
  }, [hasUnsavedInput, closeAndReset]);
  // Drawer is an optional Core-Primitive (additive rollout) — same "skip +
  // warn" precedent as rowActions without a mounted DispatcherProvider above,
  // instead of crashing when a web app hasn't upgraded its createKumikoApp
  // wiring yet. The warning repeats per mount and whenever the action changes.
  // Dev-time setup error, so no dedupe.
  useEffect(() => {
    if (drawerAction !== null && Drawer === undefined) {
      // biome-ignore lint/suspicious/noConsole: dev-warning for a setup error
      console.warn(
        `[kumiko] toolbarAction "${drawerAction.id}" is kind:"drawer", but no <Drawer> primitive is registered — it will not open. createKumikoApp() from kumiko-renderer-web wires it automatically.`,
      );
    }
  }, [drawerAction, Drawer]);

  if (drawerAction === null || Drawer === undefined) return null;

  // Access mirrors kind:"navigate" exactly: the toolbar button itself stays
  // visible either way (same as navigate — access is enforced at the
  // target, not by hiding the trigger), but the drawer shows the same
  // "Access denied" state KumikoScreen's top-level gate would show for a
  // direct hit on that screen, never the form.
  const allowed = screenAccessAllows(drawerScreen?.access, userRoles);
  const titleParams = formatSummaryParams(drawerInitialValues, locale);

  return (
    <>
      <Drawer
        open={true}
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
        title={effectiveTranslate(drawerAction.title ?? drawerAction.label, titleParams)}
        {...(drawerAction.subtitle !== undefined && {
          subtitle: effectiveTranslate(drawerAction.subtitle, titleParams),
        })}
        testId={`toolbar-drawer-${drawerAction.id}`}
      >
        <PageHeaderSlotAvailableProvider value={false}>
          <InsideDrawerProvider value={true}>
            {drawerScreen === undefined ? (
              <ScreenMissingState
                screenQn={drawerAction.screen}
                testId="kumiko-toolbar-drawer-not-found"
              />
            ) : !allowed ? (
              <ScreenAccessDeniedBanner
                screenQn={drawerAction.screen}
                testId="kumiko-toolbar-drawer-access-denied"
              />
            ) : (
              <ActionFormBody
                schema={schema}
                screen={drawerScreen}
                {...(translate !== undefined && { translate })}
                {...(drawerInitialValues !== undefined && {
                  initialOverrides: drawerInitialValues,
                })}
                onSuccess={() => {
                  setHasUnsavedInput(false);
                  onSuccess();
                }}
                onCancelOverride={requestClose}
                onDirtyChange={setHasUnsavedInput}
                submitLabelFallback={drawerAction.label}
              />
            )}
          </InsideDrawerProvider>
        </PageHeaderSlotAvailableProvider>
      </Drawer>
      <Dialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        title={t("kumiko.drawer.discard.title")}
        description={t("kumiko.drawer.discard.body")}
        confirmLabel={t("kumiko.drawer.discard.confirm")}
        cancelLabel={t("kumiko.drawer.discard.cancel")}
        variant="danger"
        initialFocus="cancel"
        onConfirm={closeAndReset}
        testId="drawer-discard-dialog"
      />
    </>
  );
}

// Action form body: non-CRUD form driven by a write handler. Reuses
// RenderEdit via a synthesized EntityDefinition + EntityEditScreen
// definition (see action-form-shim.ts for the debt doc). The form mechanics
// (useForm, RenderEdit, DefaultInput, Banner, submit button) are identical
// to entityEdit, only the submit path switches from the CRUD verb to the
// author-declared handler QN + payloadMode="values" (send all form values
// instead of only the changes).
export function ActionFormBody({
  schema,
  screen,
  translate,
  entityId,
  initialOverrides,
  onSuccess,
  onCancelOverride,
  onDirtyChange,
  submitLabelFallback,
}: {
  readonly schema: FeatureSchema;
  readonly screen: ActionFormScreenDefinition;
  readonly translate?: Translate;
  /** Record id from the route path; the source of the `load` query's id. */
  readonly entityId?: string;
  /** Row-drawer usage (RowAction kind:"drawer", fw#2710): prefill extracted
   *  from the clicked row, applied on top of searchParams through the same
   *  renderableFields/sensitive gates (see mergeSearchParamsIntoInitial). */
  readonly initialOverrides?: Readonly<Record<string, unknown>>;
  /** Drawer-hosted usage (toolbarAction kind:"drawer", fw#2225): called
   *  instead of the redirect-based navigation on successful submit, so the
   *  host closes the drawer + refetches its list regardless of whether
   *  `screen.redirect` is set — a full-page redirect would navigate away
   *  from the list the drawer sits on top of. */
  readonly onSuccess?: () => void;
  /** Drawer-hosted usage: replaces the cancelTarget/redirect-based Cancel
   *  handler so Cancel closes the drawer instead of navigating. */
  readonly onCancelOverride?: () => void;
  /** Drawer-hosted usage: reports unsaved input so the host can confirm
   *  before discarding it. */
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Drawer-hosted usage: submit label when the screen declares none (the opening action's label). */
  readonly submitLabelFallback?: string;
}): ReactNode {
  const nav = useNav();
  const appFeatures = useAppFeatures();
  const insideDrawer = useInsideDrawer();
  const locale = useLocale().locale();
  const { Banner } = usePrimitives();
  // Unused when drawer-hosted — onSuccess/onCancelOverride win below first.
  const returnTarget = useReturnTarget(screen.id);
  const submittableFields = useMemo(() => actionFormSubmittableFields(screen), [screen]);
  const synthEntity = useMemo(
    () => synthesizeActionFormEntity(submittableFields),
    [submittableFields],
  );
  const synthScreen = useMemo(() => synthesizeActionFormScreen(screen), [screen]);
  const pendingHandoff = useInitialValuesHandoff(screen.id);
  // A drawer-hosted form is not a navigation target, so it never takes a handoff.
  const handoffValues = onSuccess === undefined ? pendingHandoff : undefined;
  // This screen has no entity, so a money field here declares its own currency
  // source (fw#2839, boot-enforced) — without one the form would seed a bare
  // `0` the handler's schema rejects. When a tenant-declared field's config
  // query errors or holds no value there is no entity default to use, and
  // submitting a guessed currency would mis-book the amount — block instead.
  const tenantCurrencyFieldNames = useMemo(
    () => tenantCurrencyMoneyFieldNames(screen.fields),
    [screen.fields],
  );
  const {
    overrides: moneyCurrencyOverrides,
    loading: currencyLoading,
    unresolved: currencyUnresolved,
  } = useMoneyCurrencyOverrides(screen.fields, tenantCurrencyFieldNames, undefined);
  const loadableFieldNames = useMemo(
    () =>
      Object.entries(submittableFields)
        .filter(([, field]) => !isSecretFormField(field))
        .map(([name]) => name),
    [submittableFields],
  );
  const loadState = useActionFormLoad(
    screen.load,
    screen.load !== undefined
      ? resolveActionFormRecordId({
          routeEntityId: entityId,
          drawerOverrides: initialOverrides,
          searchParams: nav.searchParams,
        })
      : undefined,
    loadableFieldNames,
  );
  const loadedValues = loadState?.status === "ready" ? loadState.values : undefined;
  const initial = useMemo(() => {
    // With `load` the loaded record is the only source of values: a crafted link
    // or a row's params must not seed fields the record would otherwise own.
    const prefillSources =
      screen.load !== undefined
        ? { searchParams: {}, urlPrefillFields: undefined }
        : {
            searchParams: nav.searchParams,
            urlPrefillFields: screen.urlPrefillFields,
            ...(initialOverrides !== undefined && { drawerOverrides: initialOverrides }),
            ...(handoffValues !== undefined && { handoffValues }),
          };
    return {
      ...mergeSearchParamsIntoInitial(submittableFields, {
        ...prefillSources,
        renderableFields: layoutFieldNames(synthScreen),
        ...(moneyCurrencyOverrides !== undefined && { moneyCurrencyOverrides }),
      }),
      ...loadedValues,
    };
  }, [
    submittableFields,
    screen.load,
    screen.urlPrefillFields,
    nav.searchParams,
    synthScreen,
    moneyCurrencyOverrides,
    initialOverrides,
    handoffValues,
    loadedValues,
  ]);
  const derivedInitial = useMemo(
    () => withDerivedValues(initial, screen.derive !== undefined ? screen : undefined),
    [initial, screen],
  );
  const t = useTranslation();
  const effectiveTranslate = translate ?? t;
  const summary = useMemo(
    () => resolveActionFormSummary(screen.summary, initialOverrides, effectiveTranslate, locale),
    [screen.summary, initialOverrides, effectiveTranslate, locale],
  );
  const dispatcher = useDispatcher();
  const [success, setSuccess] = useState<ActionFormSuccessState | undefined>(undefined);
  // Bumped after a successful submit with resetOnSuccess: remounts RenderEdit, which
  // re-seeds the form from `initial` (prefill kept, typed values cleared).
  const [formEpoch, setFormEpoch] = useState(0);
  // A slow label lookup of an earlier submit must not overwrite the banner of a later one.
  const successSequence = useRef(0);
  useEffect(
    () => () => {
      successSequence.current += 1;
    },
    [],
  );
  const handleSubmitted = useCallback(
    (result: SubmitResult<unknown>, values: FormValues) => {
      successSequence.current += 1;
      const sequence = successSequence.current;
      setSuccess(undefined);
      if (!result.isSuccess) return;
      if (onSuccess !== undefined) {
        onSuccess();
        return;
      }
      if (screen.redirect === undefined) {
        const hasSuccessLinks =
          (screen.successLinks?.length ?? 0) > 0 || (screen.successFacts?.length ?? 0) > 0;
        const publish = (text: string): void => {
          if (successSequence.current !== sequence) return;
          setSuccess({
            text,
            links: resolveSuccessLinks(
              screen.successLinks,
              result.data,
              schema,
              appFeatures,
              nav,
              effectiveTranslate,
            ),
            facts: resolveSuccessFacts(
              screen.successFacts,
              result.data,
              effectiveTranslate,
              locale,
            ),
          });
        };
        const messageKey = screen.successMessage;
        if (messageKey !== undefined) {
          const show = (params: Record<string, string>): void =>
            publish(effectiveTranslate(messageKey, params));
          void resolveSuccessMessageParams(screen, schema.featureName, values, dispatcher, locale)
            .then(show)
            .catch(() => show(formatSummaryParams(values, locale)));
        } else if (hasSuccessLinks || screen.resetOnSuccess === true) {
          publish(effectiveTranslate("kumiko.actionForm.success"));
        }
        if (screen.resetOnSuccess === true) setFormEpoch((epoch) => epoch + 1);
      }
      // Without a redirect the form stays put; returnTo only replaces an existing
      // navigation, and never one to a record screen (see redirectTargetsRecord).
      if (screen.redirect !== undefined) {
        if (returnToWinsOverRedirect(returnTarget, screen.redirect, schema, appFeatures)) {
          navigateToReturn(nav, returnTarget);
        } else {
          navigateToRedirectTarget(
            nav,
            resolveRedirectTarget(screen.redirect, result.data, schema, appFeatures),
          );
        }
      }
    },
    [
      nav,
      screen,
      onSuccess,
      schema,
      appFeatures,
      returnTarget,
      dispatcher,
      locale,
      effectiveTranslate,
    ],
  );
  // The success box disappears with the next edit; a submit clears it itself.
  const handleDirtyChange = useCallback(
    (dirty: boolean) => {
      if (dirty) {
        successSequence.current += 1;
        setSuccess(undefined);
      }
      onDirtyChange?.(dirty);
    },
    [onDirtyChange],
  );
  // Cancel only makes sense when a navigation target exists, otherwise the
  // button would have nowhere to navigate. cancelTarget wins over redirect;
  // `false` switches the button off explicitly (single-action screens where
  // cancel would just be submit-without-sending).
  // returnTo wins over the declared target when both are present.
  const handleCancel = useMemo<(() => void) | undefined>(() => {
    if (onCancelOverride !== undefined) return onCancelOverride;
    const target =
      screen.cancelTarget ??
      (screen.redirect !== undefined ? redirectScreenTarget(screen.redirect) : undefined);
    if (target === undefined || target === false) return undefined;
    return () =>
      navigateToReturnOr(nav, returnTarget, () => nav.navigate({ screenId: lastSegment(target) }));
  }, [nav, screen.redirect, screen.cancelTarget, onCancelOverride, returnTarget]);
  // Rendering the form before a tenant-declared currency lands would show the
  // fallback and, on a fast click, submit it (fw#2933) — hold instead.
  if (currencyLoading) {
    return <QueryLoadingBanner />;
  }
  if (currencyUnresolved) {
    return (
      <Banner padded variant="error" testId="kumiko-screen-currency-unresolved">
        The tenant currency could not be loaded, so this form cannot be submitted.
      </Banner>
    );
  }
  if (loadState !== undefined && loadState.status !== "ready") {
    return (
      <ActionFormLoadStatus state={loadState} screenId={screen.id} translate={effectiveTranslate} />
    );
  }
  return (
    <RenderEdit
      key={formEpoch}
      screen={synthScreen}
      entity={synthEntity}
      featureName={schema.featureName}
      initial={derivedInitial}
      {...(screen.derive !== undefined && { formDerivation: screen })}
      actionFormScreenQn={qualifyScreenId(schema.featureName, screen.id)}
      // Extension sections in the actionForm see the initial form values
      // (incl. searchParams prefill, e.g. ?incidentId=...) as initialValues;
      // unlike entityEdit there is no record they could draw context from.
      extensionInitialValues={initial}
      {...(screen.submitPrefilled === true && {
        submitWithoutChanges: hiddenRequiredFieldsFilled(synthScreen, screen.fields, initial),
      })}
      {...(success !== undefined && {
        leadContent: <ActionFormSuccessBanner success={success} />,
      })}
      writeCommand={screen.handler}
      payloadMode="values"
      onSubmit={handleSubmitted}
      {...(handleCancel !== undefined && { onCancel: handleCancel })}
      onDirtyChange={handleDirtyChange}
      {...((insideDrawer || screenFillsHeight(screen)) && { fillScreenHeight: true })}
      {...((screen.submitLabel ?? submitLabelFallback) !== undefined && {
        submitLabel: screen.submitLabel ?? submitLabelFallback,
      })}
      {...(screen.submitStyle !== undefined && { submitVariant: screen.submitStyle })}
      {...(screen.footerActions !== undefined && { footerActions: screen.footerActions })}
      {...(summary !== undefined && { summary })}
      {...(translate !== undefined && { translate })}
    />
  );
}
