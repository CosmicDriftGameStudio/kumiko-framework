import type { ReactNode } from "react";
import type { EditSectionViewModel, FormValues } from "../headless/index.ts";
import { ExtensionSectionMount } from "./edit-mounts.tsx";
import { RelatedListSection } from "./related-list-section.tsx";
import { RenderEditActionButton } from "./render-edit-action-button.tsx";
import { renderFieldsSection } from "./render-edit-fields-section.tsx";
import { wizardStepKey } from "./render-edit-helpers.tsx";
import { resolveExtensionEntityId } from "./render-edit-logic.ts";
import type { RenderEditModel, SectionRenderContext } from "./render-edit-render-model.ts";
import { WriteFormSection } from "./write-form-section.tsx";

type ExtensionSection = Extract<EditSectionViewModel, { readonly kind: "extension" }>;
type RelatedListSectionModel = Extract<EditSectionViewModel, { readonly kind: "relatedList" }>;
type WriteFormSectionModel = Extract<EditSectionViewModel, { readonly kind: "writeForm" }>;

function renderExtensionSection<TValues extends FormValues, TCtx>(
  { model, sectionIndex, sectionActionsEl, wrapWizardStep }: SectionRenderContext<TValues, TCtx>,
  section: ExtensionSection,
): ReactNode {
  const { props, state, form, draft, sections } = model.engine;
  const { hideSectionTitles } = props;
  const { Card } = state.primitives;
  const mount = (
    <ExtensionSectionMount
      key={section.title}
      section={section}
      entityName={sections.vm.entityName}
      entityId={resolveExtensionEntityId(props.entityId, sections.vm.id)}
      initialValues={props.extensionInitialValues}
      values={form.snapshot.values}
      patch={model.patchForExtension}
      validate={draft.scopedValidate}
      markSaved={draft.markSaved}
      hideTitle={hideSectionTitles}
      {...(state.isWizard &&
        !state.isCreateMode && {
          stepKey: wizardStepKey(section, sectionIndex),
          onReportStepComplete: state.reportExtensionStepComplete,
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

function renderRelatedListSection<TValues extends FormValues, TCtx>(
  { model, sectionActionsEl }: SectionRenderContext<TValues, TCtx>,
  section: RelatedListSectionModel,
): ReactNode {
  const { props, form, sections } = model.engine;
  const { hideSectionTitles, fillScreenHeight, refreshToken, onRelatedListDrawerAction } = props;
  // parentId is the displayed record's id — without it there's no
  // parent row whose related rows could be queried.
  // Rejected at boot in wizard layouts, so no WizardStepGroup here.
  const parentId = resolveExtensionEntityId(props.entityId, sections.vm.id);
  if (parentId === null) return null;
  const mount = (
    <RelatedListSection
      key={section.title}
      section={section}
      parentId={parentId}
      // @cast-boundary form-values: TValues is structurally a Record.
      record={form.snapshot.values as unknown as Readonly<Record<string, unknown>>}
      featureName={props.featureName}
      translate={model.engine.state.translate}
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

function renderWriteFormSection<TValues extends FormValues, TCtx>(
  { model, sectionIndex, sectionActionsEl }: SectionRenderContext<TValues, TCtx>,
  section: WriteFormSectionModel,
): ReactNode {
  const { props, state, sections } = model.engine;
  // Own submit button + dispatcher call, entirely independent of
  // this screen's (nonexistent, on projectionDetail) form submit —
  // rejected at boot in wizard layouts, so no WizardStepGroup here.
  return (
    <WriteFormSection
      key={section.title ?? `write-form-${sectionIndex}`}
      section={section}
      featureName={props.featureName}
      translate={state.translate}
      hideTitle={props.hideSectionTitles}
      onSubmitted={() => props.onReload?.()}
      {...(sections.isLoneWriteFormTab && { onFooterAction: sections.setWriteFormFooterAction })}
      {...(sectionActionsEl !== undefined && { actions: sectionActionsEl })}
    />
  );
}

function renderSectionByKind<TValues extends FormValues, TCtx>(
  rc: SectionRenderContext<TValues, TCtx>,
  section: EditSectionViewModel,
): ReactNode {
  switch (section.kind) {
    case "extension":
      return renderExtensionSection(rc, section);
    case "relatedList":
      return renderRelatedListSection(rc, section);
    case "writeForm":
      return renderWriteFormSection(rc, section);
    case "fields":
      return renderFieldsSection(rc, section);
  }
}

// turns this section's own `actions` (RowAction[]) into
// already-bound buttons via the caller-supplied builder, rendered
// through the same RenderEditActionButton the top-level `actions`
// prop uses (same style/confirm/icon/error handling).
function renderSectionActions<TValues extends FormValues, TCtx>(
  { engine: { props, state } }: RenderEditModel<TValues, TCtx>,
  section: EditSectionViewModel,
): ReactNode {
  const sectionActions = section.actions;
  if (sectionActions === undefined || sectionActions.length === 0) return undefined;
  const { Button, Dialog } = state.primitives;
  return props
    .buildSectionActions?.(sectionActions)
    ?.map((action) => (
      <RenderEditActionButton
        key={action.id}
        action={action}
        Button={Button}
        Dialog={Dialog}
        onError={state.setActionError}
      />
    ));
}

// Wizard steps and tabs stay mounted while off-screen (native
// `hidden`, not unmounted) so an extension section's submit-registry
// entry (useExtensionFormSubmit → registry.remove on unmount)
// survives navigating past its step — otherwise Finish only ran the
// last mounted step's handler and silently dropped earlier steps'
// writes. For tabs this is also what makes ONE submit cover every
// tab, including tabs the user never opened.
// Off-screen wizard steps stay mounted (see comment above) but must
// not participate in native constraint validation, or the Next
// button's `type="submit"` triggers the browser's full-form check
// — including required fields on unvisited steps, which are not
// focusable while hidden, so the wizard silently stops navigating
// (only a console warning, no visible error). A plain `hidden`
// attribute does NOT bar descendants from constraint validation on
// web — see WizardStepGroupProps for what implementations must
// guarantee.
function createWizardStepWrapper<TValues extends FormValues, TCtx>(
  { engine: { props, state, steps } }: RenderEditModel<TValues, TCtx>,
  sectionIndex: number,
): (key: string, el: ReactNode) => ReactNode {
  const { WizardStepGroup } = state.primitives;
  const stepHidden = state.isStepped && sectionIndex !== steps.currentStep;
  return (key, el) => {
    if (!state.isStepped) return el;
    if (WizardStepGroup === undefined) {
      throw new Error(
        `RenderEdit: ${props.screen.layout.mode} layout requires primitives.WizardStepGroup, but none is registered.`,
      );
    }
    return (
      <WizardStepGroup
        key={key}
        hidden={stepHidden}
        {...(props.hideSectionTitles === true && { inset: true })}
      >
        {el}
      </WizardStepGroup>
    );
  };
}

export function renderEditSections<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): ReactNode {
  return model.engine.sections.filteredSections.map(
    (section: EditSectionViewModel, sectionIndex: number) =>
      renderSectionByKind(
        {
          model,
          sectionIndex,
          sectionActionsEl: renderSectionActions(model, section),
          wrapWizardStep: createWizardStepWrapper(model, sectionIndex),
        },
        section,
      ),
  );
}
