import type { PlatformComponent } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useCallback, useEffect } from "react";
import { extensionSectionName, useExtensionSectionComponent } from "../app/extension-sections.tsx";
import { rendererWarn } from "../dev-console.ts";
import type { EditExtensionSectionViewModel } from "../headless/index.ts";
import { type StickyPrimaryActionMarker, usePrimitives } from "../primitives.tsx";

// Resolves an extension-section's `{ react: { __component: "X" } }` marker
// to a registered React component via ExtensionSectionsProvider (filled in
// createKumikoApp from clientFeatures.extensionSectionComponents) and
// mounts it with the host entity name + id. Hook lives in its own
// component so we don't call `use*` inside vm.sections.map (rules-of-
// hooks would punish reordering sections between renders).
export function ExtensionSectionMount({
  section,
  entityName: hostEntityName,
  entityId,
  initialValues,
  values,
  patch,
  validate,
  markSaved,
  hideTitle,
  actions,
  stepKey,
  onReportStepComplete,
}: {
  readonly section: EditExtensionSectionViewModel;
  readonly entityName: string;
  readonly entityId: string | null;
  readonly initialValues?: Readonly<Record<string, unknown>>;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly patch?: (partial: Readonly<Record<string, unknown>>) => void;
  readonly validate?: () => boolean;
  readonly markSaved?: () => void;
  readonly hideTitle?: boolean;
  /** section.actions, already resolved into buttons by the caller. */
  readonly actions?: ReactNode;
  readonly stepKey?: string;
  readonly onReportStepComplete?: (stepKey: string, complete: boolean) => void;
}): ReactNode {
  const { Banner, FillContainer, Section, Text } = usePrimitives();
  const name = extensionSectionName(section.component);
  const Component = useExtensionSectionComponent(name);
  const reportStepComplete = useCallback(
    (complete: boolean) => {
      if (stepKey !== undefined) onReportStepComplete?.(stepKey, complete);
    },
    [stepKey, onReportStepComplete],
  );
  const testId = `section-extension-${section.title}`;
  if (Component === undefined) {
    const placeholder = (
      <Banner variant="info" testId={`section-extension-placeholder-${section.title}`}>
        <Text>
          Extension section component <Text variant="code">{name ?? "(no __component name)"}</Text>{" "}
          not registered in clientFeatures.extensionSectionComponents.
        </Text>
      </Banner>
    );
    // Tabs mode already frames this in the caller's own Card — a Section
    // here would add a second, unwanted divider inset (px-6 py-4) on top of
    // the Card's own padding, misaligning this tab's content against the
    // fields tab (Grid sits directly in the Card there). FillContainer keeps
    // the testId without adding chrome (same primitive RelatedListSection
    // uses for its own hideTitle branch).
    return hideTitle === true ? (
      FillContainer !== undefined ? (
        <FillContainer testId={testId}>{placeholder}</FillContainer>
      ) : (
        placeholder
      )
    ) : (
      <Section key={section.title} title={section.title} testId={testId}>
        {placeholder}
      </Section>
    );
  }
  const mounted = (
    <Component
      entityName={section.entityName ?? hostEntityName}
      entityId={entityId}
      initialValues={initialValues}
      values={values}
      patch={patch}
      validate={validate}
      markSaved={markSaved}
      {...(onReportStepComplete !== undefined && { reportStepComplete })}
    />
  );
  // Same reasoning as the placeholder branch above: tabs mode's outer Card
  // is the only frame this content gets, no nested Section divider.
  return hideTitle === true ? (
    FillContainer !== undefined ? (
      <FillContainer testId={testId}>{mounted}</FillContainer>
    ) : (
      mounted
    )
  ) : (
    <Section {...(actions !== undefined && { actions })} title={section.title} testId={testId}>
      {mounted}
    </Section>
  );
}

// Resolves an entityEdit slot's (`screen.slots.header` / `.footer`)
// `{ react: { __component: "X" } }` marker via the same ExtensionSectionsProvider
// registry as ExtensionSectionMount / ListHeaderSlotMount and mounts it. One
// component for both slots — header passes no hasUnsavedChanges/wizardStep,
// footer does. Own component for rules-of-hooks (useExtensionSectionComponent
// must not run conditionally inside RenderEdit's render body).
export function EditSlotMount({
  slot,
  slotName,
  screenId,
  entityName,
  entityId,
  values,
  markSaved,
  hasUnsavedChanges,
  wizardStep,
}: {
  readonly slot: PlatformComponent;
  readonly slotName: "header" | "titleAction" | "footer";
  readonly screenId: string;
  readonly entityName: string;
  readonly entityId: string | null;
  readonly values: Readonly<Record<string, unknown>>;
  readonly markSaved?: () => void;
  readonly hasUnsavedChanges?: boolean;
  readonly wizardStep?: { readonly index: number; readonly isLast: boolean };
} & StickyPrimaryActionMarker): ReactNode {
  const name = extensionSectionName(slot);
  const Component = useExtensionSectionComponent(name);
  useEffect(() => {
    if (name !== undefined && Component === undefined) {
      rendererWarn(
        `[kumiko] Edit ${slotName} slot component "${name}" on screen "${screenId}" is not registered in clientFeatures.extensionSectionComponents — the ${slotName} slot renders nothing.`,
      );
    }
  }, [name, Component, screenId, slotName]);
  if (Component === undefined) return null;
  return (
    <Component
      entityName={entityName}
      entityId={entityId}
      values={values}
      {...(markSaved !== undefined && { markSaved })}
      {...(hasUnsavedChanges !== undefined && { hasUnsavedChanges })}
      {...(wizardStep !== undefined && { wizardStep })}
    />
  );
}
