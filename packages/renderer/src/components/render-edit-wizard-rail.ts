import {
  type EditSectionViewModel,
  EMPTY_VALUE_PLACEHOLDER,
  type FormValues,
} from "../headless/index.ts";
import { resolveSubmitLabelKey } from "./render-edit-form-actions.tsx";
import type { RenderEditModel } from "./render-edit-render-model.ts";
import { readOnlyDisplayText } from "./render-field-read-only.tsx";

type FieldsSectionViewModel = Extract<EditSectionViewModel, { kind: "fields" }>;

export type WizardRail = {
  readonly description: string | undefined;
  readonly subtitles: readonly (string | undefined)[];
  readonly upNext: { heading: string; title: string; subtitle?: string } | undefined;
};

function fieldsSection(
  section: EditSectionViewModel | undefined,
): FieldsSectionViewModel | undefined {
  return section?.kind === "fields" ? section : undefined;
}

export function deriveWizardRail<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): WizardRail {
  const { engine, titles } = model;
  const { state, steps, sections, props } = engine;
  const { translate, appLocale } = state;
  const { filteredSections } = sections;
  const { currentStep } = steps;
  const wizard = props.screen.layout.wizard;

  const isDone = (index: number): boolean =>
    index !== currentStep &&
    (steps.wizardDoneSteps !== undefined
      ? steps.wizardDoneSteps[index] === true
      : index < currentStep);

  function summaryValue(section: FieldsSectionViewModel): string | undefined {
    const field = section.fields.find((candidate) => candidate.field === section.summaryField);
    if (field === undefined) return undefined;
    const text = readOnlyDisplayText(field, appLocale, translate);
    return text === EMPTY_VALUE_PLACEHOLDER ? undefined : text;
  }

  // The current step's description is the rail heading text, so it is not repeated as the row subtitle.
  const subtitles = filteredSections.map((section, index) => {
    const fields = fieldsSection(section);
    if (fields === undefined) return undefined;
    if (isDone(index)) {
      const summary = summaryValue(fields);
      if (summary !== undefined) return summary;
    }
    return fields.subtitle ?? (index === currentStep ? undefined : fields.description);
  });

  const nextSection = filteredSections[currentStep + 1];
  const nextFields = fieldsSection(nextSection);
  const heading = translate("kumiko.wizard.up-next");
  let upNext: WizardRail["upNext"];
  if (wizard?.aside?.upNext !== true) upNext = undefined;
  else if (nextSection !== undefined) {
    const subtitle = nextFields?.subtitle ?? nextFields?.description;
    upNext = {
      heading,
      title: nextSection.title ?? "",
      ...(subtitle !== undefined && { subtitle }),
    };
  } else if (wizard.aside.finishDescription !== undefined) {
    upNext = {
      heading,
      title: translate(resolveSubmitLabelKey(model)),
      subtitle: translate(wizard.aside.finishDescription),
    };
  }

  return {
    description: fieldsSection(filteredSections[currentStep])?.description ?? titles.formSubtitle,
    subtitles,
    upNext,
  };
}
