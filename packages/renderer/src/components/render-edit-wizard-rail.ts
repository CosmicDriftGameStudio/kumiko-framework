import {
  type EditSectionViewModel,
  EMPTY_VALUE_PLACEHOLDER,
  type FormValues,
} from "../headless/index.ts";
import { resolveSubmitLabelKey } from "./render-edit-form-actions.tsx";
import type { RenderEditModel } from "./render-edit-render-model.ts";
import { readOnlyDisplayText } from "./render-field-read-only.tsx";

type RailTextSection = Extract<EditSectionViewModel, { kind: "fields" | "extension" }>;

export type WizardRail = {
  readonly description: string | undefined;
  readonly subtitles: readonly (string | undefined)[];
  readonly upNext: { heading: string; title: string; subtitle?: string } | undefined;
};

function railTextSection(section: EditSectionViewModel | undefined): RailTextSection | undefined {
  return section?.kind === "fields" || section?.kind === "extension" ? section : undefined;
}

function isPrintable(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function deriveWizardRail<TValues extends FormValues, TCtx>(
  model: RenderEditModel<TValues, TCtx>,
): WizardRail {
  const { engine, titles } = model;
  const { state, steps, sections, props, form } = engine;
  const { translate, appLocale } = state;
  const { filteredSections } = sections;
  const { currentStep } = steps;
  const wizard = props.screen.layout.wizard;

  const isDone = (index: number): boolean =>
    index !== currentStep &&
    (steps.wizardDoneSteps !== undefined
      ? steps.wizardDoneSteps[index] === true
      : index < currentStep);

  // An extension has no fields of its own, so its summaryField resolves against every
  // fields section, then against the raw form value (an actionForm field no section lists).
  function summaryValue(section: RailTextSection): string | undefined {
    const name = section.summaryField;
    if (name === undefined) return undefined;
    const field = filteredSections
      .flatMap((candidate) => (candidate.kind === "fields" ? candidate.fields : []))
      .find((candidate) => candidate.field === name);
    if (field !== undefined) {
      const text = readOnlyDisplayText(field, appLocale, translate);
      return text === EMPTY_VALUE_PLACEHOLDER ? undefined : text;
    }
    const raw: unknown = form.snapshot.values[name];
    return isPrintable(raw) && raw !== "" ? String(raw) : undefined;
  }

  const subtitles = filteredSections.map((section, index) => {
    const texts = railTextSection(section);
    if (texts === undefined || index === currentStep) return undefined;
    if (isDone(index)) {
      const summary = summaryValue(texts);
      if (summary !== undefined) return summary;
    }
    return texts.subtitle;
  });

  const nextSection = filteredSections[currentStep + 1];
  const nextTexts = railTextSection(nextSection);
  const heading = translate("kumiko.wizard.up-next");
  let upNext: WizardRail["upNext"];
  if (wizard?.aside?.upNext !== true) upNext = undefined;
  else if (nextSection !== undefined) {
    const subtitle = nextTexts?.upNextHint ?? nextTexts?.subtitle;
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
    description: railTextSection(filteredSections[currentStep])?.description ?? titles.formSubtitle,
    subtitles,
    upNext,
  };
}
