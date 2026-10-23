import type { EditSectionViewModel, FormValues, Translate } from "../headless/index.ts";
import type { FormSectionNavItem } from "../primitives.tsx";
import {
  formSectionDomId,
  resolveRecordTitle,
  resolveTitleTemplate,
} from "./render-edit-helpers.tsx";
import type { FooterFlags, LayoutFlags } from "./render-edit-layout-flags.ts";
import type { RenderEditEngine } from "./render-edit-render-model.ts";

export type TitleModel = {
  readonly recordTitle: string | undefined;
  readonly formTitle: string;
  readonly formSubtitle: string | undefined;
  readonly titleInSettingsHeader: boolean;
  readonly usesFieldFlow: boolean;
  readonly recordTitleInHeaderRegion: boolean;
  readonly stepRail: boolean;
  readonly upNextSection: EditSectionViewModel | undefined;
  readonly sectionNavItems: readonly FormSectionNavItem[];
  readonly compactStepLabel: string;
};

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
function createScreenTextResolver(
  translate: Translate,
  i18nScreenId: string,
  formMode: "create" | "view" | "edit",
): (suffix: string) => string | undefined {
  return (suffix) => {
    for (const key of [
      `screen:${i18nScreenId}.${formMode}.${suffix}`,
      `screen:${i18nScreenId}.${suffix}`,
    ]) {
      const value = translate(key);
      if (value !== key) return value;
    }
    return undefined;
  };
}

// In tabs mode (hideSectionTitles) screen.description is dropped — the head
// card carries it — but an explicit subtitle i18n override has no other
// source there, so it stays unless it merely resolves to the description.
function resolveFormSubtitle(
  hideSectionTitles: boolean | undefined,
  explicitSubtitle: string | undefined,
  descriptionSubtitle: string | undefined,
): string | undefined {
  if (hideSectionTitles !== true) return explicitSubtitle ?? descriptionSubtitle;
  return explicitSubtitle !== descriptionSubtitle ? explicitSubtitle : undefined;
}

function sectionNavItemsFor(
  section: EditSectionViewModel,
  index: number,
  formTitle: string,
): readonly FormSectionNavItem[] {
  const isNavigable =
    section.kind === "fields" &&
    section.visible &&
    section.title !== undefined &&
    section.title !== formTitle;
  return isNavigable && section.title !== undefined
    ? [{ id: formSectionDomId(index), title: section.title }]
    : [];
}

function deriveSectionNavItems(
  filteredSections: readonly EditSectionViewModel[],
  formTitle: string,
): readonly FormSectionNavItem[] {
  return filteredSections.flatMap((section, index) =>
    sectionNavItemsFor(section, index, formTitle),
  );
}

function deriveCompactStepLabel(
  translate: Translate,
  currentTitle: string | undefined,
  currentStep: number,
  lastStepIndex: number,
): string {
  return currentTitle !== undefined
    ? translate("kumiko.wizard.step-with-title", {
        current: currentStep + 1,
        total: lastStepIndex + 1,
        title: currentTitle,
      })
    : translate("kumiko.wizard.step", { current: currentStep + 1, total: lastStepIndex + 1 });
}

function deriveFormTitleTexts<TValues extends FormValues, TCtx>(
  { props, state, form }: RenderEditEngine<TValues, TCtx>,
  isCreate: boolean,
) {
  const { screen, hideSectionTitles } = props;
  const { translate } = state;
  const formMode = isCreate ? "create" : props.viewMode ? "view" : "edit";
  const recordTitle =
    !isCreate && screen.recordTitleField !== undefined
      ? resolveRecordTitle(props.initial[screen.recordTitleField])
      : undefined;
  const resolveScreenText = createScreenTextResolver(translate, props.i18nScreenId, formMode);
  const plainFormTitle = resolveScreenText("title") ?? props.i18nScreenId;
  const formTitle = resolveTitleTemplate(
    screen.titleTemplate,
    form.snapshot.values,
    translate,
    plainFormTitle,
  );
  const explicitSubtitle = resolveScreenText("subtitle");
  const descriptionSubtitle =
    screen.description !== undefined ? translate(screen.description) : undefined;
  const formSubtitle = resolveFormSubtitle(
    hideSectionTitles,
    explicitSubtitle,
    descriptionSubtitle,
  );
  return { recordTitle, formTitle, formSubtitle };
}

export function deriveTitles<TValues extends FormValues, TCtx>(
  engine: RenderEditEngine<TValues, TCtx>,
  layout: LayoutFlags,
  footer: FooterFlags,
): TitleModel {
  const { props, state, sections, steps } = engine;
  const { screen, headerRegion } = props;
  const { translate } = state;
  const { filteredSections } = sections;
  const { currentStep, lastStepIndex } = steps;
  const { PageHeader, StepBar } = state.primitives;
  const { recordTitle, formTitle, formSubtitle } = deriveFormTitleTexts(engine, footer.isCreate);
  return {
    recordTitle,
    formTitle,
    formSubtitle,
    // Embedded settings-list forms (dashboard panels) have no shell header: the
    // form title/subtitle move into the first section's header column instead of
    // floating as a heading above the band.
    titleInSettingsHeader: footer.isSettingsList && !layout.titleInShell,
    usesFieldFlow: layout.isScreenForm || state.insideDrawer,
    // The caller's headerRegion already shows the record title in the shell page
    // header, so the type title ("Release") above the form would repeat it.
    recordTitleInHeaderRegion:
      headerRegion !== undefined &&
      recordTitle !== undefined &&
      PageHeader !== undefined &&
      state.pageHeaderSlotAvailable,
    stepRail: state.isWizard && layout.isScreenForm && StepBar !== undefined,
    upNextSection:
      screen.layout.wizard?.aside?.upNext === true ? filteredSections[currentStep + 1] : undefined,
    sectionNavItems:
      layout.isScreenForm && !state.isStepped
        ? deriveSectionNavItems(filteredSections, formTitle)
        : [],
    compactStepLabel: deriveCompactStepLabel(
      translate,
      filteredSections[currentStep]?.title,
      currentStep,
      lastStepIndex,
    ),
  };
}
