import type { ReactNode } from "react";
import { ExtensionFormRegistryProvider } from "../app/extension-form-submit.tsx";
import type { FormValues } from "../headless/index.ts";
import {
  renderActionErrorBanner,
  renderAllRequiredHint,
  renderDeleteDialog,
  renderDraftPicker,
  renderExtensionErrorBanner,
  renderFormErrorBanner,
  renderRootIssueBanners,
  renderTabStrip,
  renderWizardProgress,
} from "./render-edit-banners.tsx";
import { renderFormActions } from "./render-edit-form-actions.tsx";
import { buildHeaderActions, type HeaderActionsModel } from "./render-edit-header-actions.tsx";
import type { RenderEditModel } from "./render-edit-render-model.ts";
import { renderEditSections } from "./render-edit-section-kinds.tsx";
import { deriveWizardRail } from "./render-edit-wizard-rail.ts";
import { AllFieldsRequiredProvider } from "./render-field.tsx";

function renderPageHeader<TValues extends FormValues, TCtx>(
  { engine: { state }, layout, titles }: RenderEditModel<TValues, TCtx>,
  { headerMenuItems }: HeaderActionsModel,
): ReactNode {
  const { PageHeader, ActionOverflowMenu } = state.primitives;
  const { pageHeaderCompact } = state;
  return (
    layout.titleInShell &&
    PageHeader !== undefined && (
      <PageHeader
        title={titles.formTitle}
        {...(titles.recordTitle !== undefined && { recordTitle: titles.recordTitle })}
        {...(headerMenuItems.length > 0 && pageHeaderCompact && { overflowItems: headerMenuItems })}
        {...(headerMenuItems.length > 0 &&
          !pageHeaderCompact &&
          ActionOverflowMenu !== undefined && {
            actions: (
              <ActionOverflowMenu
                label={state.translate("kumiko.list.row-actions.more")}
                items={headerMenuItems}
                testId="render-edit-header-menu"
              />
            ),
          })}
      />
    )
  );
}

function renderWizardSideRail<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): ReactNode {
  const { engine, titles } = model;
  const { state, steps, sections, nav } = engine;
  const { StepBar } = state.primitives;
  const { translate } = state;
  if (StepBar === undefined) return undefined;
  const { description, subtitles, upNext } = deriveWizardRail(model);
  return (
    <StepBar
      steps={sections.filteredSections.map((section) => section.title ?? "")}
      currentIndex={steps.currentStep}
      compactLabel={titles.compactStepLabel}
      onStepSelect={nav.handleWizardStepSelect}
      {...steps.updateModeStepBarProps}
      orientation="vertical"
      heading={translate("kumiko.wizard.step", {
        current: steps.currentStep + 1,
        total: steps.lastStepIndex + 1,
      })}
      {...(description !== undefined && { description })}
      subtitles={subtitles}
      {...(upNext !== undefined && { upNext })}
      testId="render-edit-wizard-steps"
      compactTestId="render-edit-wizard-step-label"
    />
  );
}

function buildFormHeadingProps<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
) {
  const { props } = model.engine;
  const { layout, footer, titles } = model;
  const { unsavedCount, hasDirtyFooter } = footer;
  return {
    ...(props.hideSectionTitles !== true &&
      !layout.titleInShell &&
      !titles.titleInSettingsHeader &&
      !titles.titleInHeaderRegion && { title: titles.formTitle }),
    ...(titles.formSubtitle !== undefined &&
      !titles.stepRail &&
      !titles.titleInSettingsHeader && { subtitle: titles.formSubtitle }),
    ...(layout.isScreenForm && { screenForm: true }),
    ...(unsavedCount !== undefined && (unsavedCount > 0 || hasDirtyFooter) && { unsavedCount }),
    ...(titles.sectionNavItems.length > 0 && { sectionNav: titles.sectionNavItems }),
    ...(titles.stepRail && { sideRail: renderWizardSideRail(model) }),
  };
}

function buildFormActionProps<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
  header: HeaderActionsModel,
) {
  const { hideActions } = model.engine.props;
  const { footer, layout } = model;
  return {
    ...(hideActions !== true && footer.hasFormActions && { actions: renderFormActions(model) }),
    ...(hideActions !== true &&
      layout.hasSecondaryFormActions && { secondaryActions: header.secondaryFormActions }),
  };
}

function buildFormChromeProps<TValues extends FormValues, TCtx>(
  { engine: { props, sections } }: RenderEditModel<TValues, TCtx>,
  { formHeaderRegion, titleActionMount }: HeaderActionsModel,
) {
  const { summary } = props;
  return {
    ...(props.screen.layout.width !== undefined && { width: props.screen.layout.width }),
    ...(formHeaderRegion !== undefined && { headerRegion: formHeaderRegion }),
    ...(titleActionMount !== undefined && { titleAction: titleActionMount }),
    ...(sections.fillHeight && { fillHeight: sections.fillHeight }),
    ...(props.hideSectionTitles === true && { chromeless: true }),
    ...(summary !== undefined && { summary }),
  };
}

export function renderEditLayout<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): ReactNode {
  const { props, state, sections, handleSubmit } = model.engine;
  const header = buildHeaderActions(model);
  const { Form } = state.primitives;
  return (
    <ExtensionFormRegistryProvider value={state.extensionFormRegistry}>
      {state.menuActionConfirmDialog}
      {renderPageHeader(model, header)}
      <Form
        onSubmit={() => void handleSubmit()}
        {...(state.focusFirstErrorKey > 0 && { focusFirstErrorKey: state.focusFirstErrorKey })}
        {...buildFormHeadingProps(model)}
        {...buildFormActionProps(model, header)}
        testId="render-edit-form"
        stickyActions={state.isWizard || props.fillScreenHeight === true}
        {...buildFormChromeProps(model, header)}
      >
        <AllFieldsRequiredProvider
          value={sections.showsAllRequiredHint || props.screen.layout.hideRequiredMarker === true}
        >
          {props.leadContent}
          {sections.showsAllRequiredHint && !state.insideDrawer && renderAllRequiredHint(model)}
          {renderDraftPicker(model)}
          {renderWizardProgress(model)}
          {state.isTabs && state.isStepped && renderTabStrip(model)}
          {renderEditSections(model)}
          {renderFormErrorBanner(model)}
          {renderRootIssueBanners(model)}
          {renderExtensionErrorBanner(model)}
          {renderActionErrorBanner(model)}
          {renderDeleteDialog(model)}
        </AllFieldsRequiredProvider>
      </Form>
    </ExtensionFormRegistryProvider>
  );
}
