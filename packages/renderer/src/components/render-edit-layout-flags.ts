import { PROJECTION_DETAIL_ENTITY } from "@cosmicdrift/kumiko-framework/ui-types";
import type { useExtensionSectionComponent } from "../app/extension-sections.tsx";
import type { FieldIssue, FormValues } from "../headless/index.ts";
import { shouldRenderActionsIconOnly } from "../primitives.tsx";
import {
  issuesWithoutRenderedField,
  ROOT_ISSUE_PATH,
  resolveExtensionEntityId,
} from "./render-edit-logic.ts";
import type { RenderEditEngine, ResolvedRenderEditProps } from "./render-edit-render-model.ts";

export type LayoutFlags = {
  readonly rootIssues: readonly FieldIssue[];
  readonly unplacedIssues: readonly FieldIssue[];
  readonly isScreenForm: boolean;
  readonly titleInShell: boolean;
  readonly menuPageHeaderActions: boolean;
  readonly cancelInHeaderMenu: boolean;
  readonly hasSecondaryFormActions: boolean;
  readonly iconOnlyMidActions: boolean;
};

export type FooterFlags = {
  readonly isFieldlessSubmitForm: boolean;
  readonly showsSubmit: boolean;
  readonly showWizardBack: boolean;
  readonly showWizardNext: boolean;
  readonly showSubmit: boolean;
  readonly hasFormActions: boolean;
  readonly nextStepTitle: string | undefined;
  readonly isCreate: boolean;
  readonly hasDirtyFooter: boolean;
  readonly unsavedCount: number | undefined;
  readonly isSettingsList: boolean;
  readonly hasUnsavedInput: boolean;
};

export type FooterSlotComponent = ReturnType<typeof useExtensionSectionComponent>;

function hasSecondaryFormActions(
  props: Pick<
    ResolvedRenderEditProps<FormValues>,
    "onDelete" | "onCopyLink" | "actions" | "menuActions" | "onCancel"
  >,
  menuPageHeaderActions: boolean,
  cancelInHeaderMenu: boolean,
): boolean {
  const { onDelete, onCopyLink, actions, menuActions, onCancel } = props;
  const hasRecordActions =
    !menuPageHeaderActions && (onDelete !== undefined || onCopyLink !== undefined);
  const hasCustomActions = actions !== undefined && actions.length > 0;
  const hasMenuActions =
    !menuPageHeaderActions && menuActions !== undefined && menuActions.length > 0;
  const hasCancel = onCancel !== undefined && !cancelInHeaderMenu;
  return hasRecordActions || hasCustomActions || hasMenuActions || hasCancel;
}

export function deriveLayoutFlags<TValues extends FormValues, TCtx>({
  props,
  state,
  form,
  sections,
}: RenderEditEngine<TValues, TCtx>): LayoutFlags {
  const { fillScreenHeight, hideSectionTitles, headerRegion, actions, onCancel } = props;
  const { PageHeader, ActionOverflowMenu } = state.primitives;
  // Screen forms (entityEdit/actionForm filling the shell height) drop the card;
  // the title then lives in the shell header when the shell offers a slot.
  const rootIssues = form.snapshot.errors[ROOT_ISSUE_PATH] ?? [];
  const isScreenForm =
    fillScreenHeight === true && hideSectionTitles !== true && !state.insideDrawer;
  const titleInShell =
    PageHeader !== undefined &&
    state.pageHeaderSlotAvailable &&
    hideSectionTitles !== true &&
    headerRegion === undefined;
  const menuPageHeaderActions = titleInShell && isScreenForm && ActionOverflowMenu !== undefined;
  const cancelInHeaderMenu = menuPageHeaderActions && state.isWizard && onCancel !== undefined;
  return {
    rootIssues,
    unplacedIssues: issuesWithoutRenderedField(
      form.snapshot.errors,
      sections.filteredSections,
      new Set(Object.keys(props.formDerivation?.derive ?? {})),
    ),
    isScreenForm,
    titleInShell,
    menuPageHeaderActions,
    cancelInHeaderMenu,
    // Two groups — wizard navigation on the right/top, record actions on the
    // left/below; destructive action sits outermost, farthest from the target
    // action.
    hasSecondaryFormActions: hasSecondaryFormActions(
      props,
      menuPageHeaderActions,
      cancelInHeaderMenu,
    ),
    // Teil-C collapse rule: driven by the custom `actions` group only — a
    // resolved true also folds the Copy-Link button (same visual group in the
    // footer), but never Delete/Cancel, which keep their text regardless.
    iconOnlyMidActions: actions !== undefined && shouldRenderActionsIconOnly(actions),
  };
}

function isCreateRecord(entityIdProp: string | null | undefined, vmId: string | null): boolean {
  const id = resolveExtensionEntityId(entityIdProp, vmId);
  return id == null || id === "";
}

function resolveUnsavedCount(
  hasDirtyFooter: boolean,
  changedFieldCount: number,
  extensionDirty: boolean,
): number | undefined {
  if (!hasDirtyFooter) return undefined;
  if (changedFieldCount > 0) return changedFieldCount;
  return extensionDirty ? 1 : 0;
}

function showsSubmitButton<TValues extends FormValues, TCtx>(
  { props, state, sections }: RenderEditEngine<TValues, TCtx>,
  isFieldlessSubmitForm: boolean,
): boolean {
  return (
    !props.viewMode &&
    (sections.isFormEditable ||
      state.hasExtensionRegistrations ||
      isFieldlessSubmitForm ||
      props.submitWithoutChanges !== undefined)
  );
}

function deriveFormActionFlags<TValues extends FormValues, TCtx>(
  { state, sections, steps }: RenderEditEngine<TValues, TCtx>,
  showsSubmit: boolean,
  footerSlotComponent: FooterSlotComponent,
) {
  const { isWizard } = state;
  // Mirrors every branch inside formActions below — without this guard
  // DefaultForm renders an empty footer strip (border + padding, no content)
  // on read-only detail screens, since `actions` would otherwise always be
  // a defined (if empty) fragment.
  const showWizardBack = isWizard && steps.currentStep > 0;
  const showWizardNext = isWizard && !steps.isLastWizardStep;
  const showSubmit = showsSubmit && (!isWizard || steps.isLastWizardStep);
  const hasFormActions =
    showWizardBack ||
    showWizardNext ||
    showSubmit ||
    footerSlotComponent !== undefined ||
    sections.writeFormFooterAction !== undefined;
  return { showWizardBack, showWizardNext, showSubmit, hasFormActions };
}

function deriveHasDirtyFooter<TValues extends FormValues, TCtx>(
  { props, state }: RenderEditEngine<TValues, TCtx>,
  layout: LayoutFlags,
  isCreate: boolean,
): boolean {
  // Edit-mode screen forms always carry the dirty status (0 = quiet "No unsaved
  // changes"); wizards keep the status-only-when-dirty behaviour.
  return (
    !state.isWizard &&
    !props.viewMode &&
    (props.dirtyFooter === true ||
      (layout.isScreenForm && !isCreate && props.headerRegion === undefined))
  );
}

export function deriveFooterFlags<TValues extends FormValues, TCtx>(
  engine: RenderEditEngine<TValues, TCtx>,
  layout: LayoutFlags,
  footerSlotComponent: FooterSlotComponent,
): FooterFlags {
  const { props, state, form, sections, steps } = engine;
  // A projectionDetail's synthesized entity is empty when every section is an
  // extension or relatedList; that is not a fieldless submit form, so it must not
  // draw a no-op Save. Extension registrations still get their Save, since
  // persistExtensions() runs on the customSubmit path too.
  const isFieldlessSubmitForm =
    sections.isFieldless && props.screen.entity !== PROJECTION_DETAIL_ENTITY;
  const showsSubmit = showsSubmitButton(engine, isFieldlessSubmitForm);
  const isCreate = isCreateRecord(props.entityId, sections.vm.id);
  const hasDirtyFooter = deriveHasDirtyFooter(engine, layout, isCreate);
  return {
    isFieldlessSubmitForm,
    showsSubmit,
    ...deriveFormActionFlags(engine, showsSubmit, footerSlotComponent),
    nextStepTitle: state.isWizard
      ? sections.filteredSections[steps.currentStep + 1]?.title
      : undefined,
    isCreate,
    hasDirtyFooter,
    unsavedCount: resolveUnsavedCount(
      hasDirtyFooter,
      Object.keys(form.snapshot.changes).length,
      state.extensionDirty,
    ),
    isSettingsList:
      props.screen.layout.variant === "settings-list" && props.hideSectionTitles !== true,
    hasUnsavedInput: form.snapshot.isDirty || state.extensionDirty,
  };
}
