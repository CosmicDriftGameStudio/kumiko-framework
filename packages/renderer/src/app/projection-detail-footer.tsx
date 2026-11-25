import type { EditWriteFormFooterSection } from "@cosmicdrift/kumiko-framework/ui-types";
import { evalFieldCondition, isFooterWriteForm } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useMemo } from "react";
import { RenderEditActionButton } from "../components/render-edit-action-button.tsx";
import type { RenderEditAction } from "../components/render-edit-types.ts";
import { WriteFormSection } from "../components/write-form-section.tsx";
import { computeWriteFormSectionViewModel, type Translate } from "../headless/index.ts";
import { usePrimitives } from "../primitives.tsx";
import type { ErrorNotice } from "./error-reference.tsx";
import type { ProjectionDetailScreenWithTarget } from "./projection-detail-states.tsx";

/** The detail screen's footer writeForm under the body; hidden while its `visibleWhen` fails on the record. */
export function ProjectionDetailFooterForm({
  section,
  screenId,
  featureName,
  record,
  translate,
  buttons,
  onSubmitted,
  onActionError,
}: {
  readonly section: EditWriteFormFooterSection;
  readonly screenId: string;
  readonly featureName: string;
  readonly record: Readonly<Record<string, unknown>>;
  readonly translate: Translate;
  readonly buttons: readonly RenderEditAction[] | undefined;
  readonly onSubmitted: () => void;
  readonly onActionError: (notice: ErrorNotice | null) => void;
}): ReactNode {
  const { Button, Dialog } = usePrimitives();
  const form = useMemo(
    () =>
      section.visibleWhen !== undefined && !evalFieldCondition(section.visibleWhen, { ...record })
        ? undefined
        : computeWriteFormSectionViewModel(section, screenId, record, translate, featureName),
    [section, screenId, record, translate, featureName],
  );
  if (form === undefined) return null;
  return (
    <WriteFormSection
      section={form}
      featureName={featureName}
      translate={translate}
      onSubmitted={onSubmitted}
      recordValues={record}
      actions={buttons?.map((action) => (
        <RenderEditActionButton
          key={action.id}
          action={action}
          Button={Button}
          Dialog={Dialog}
          onError={onActionError}
        />
      ))}
    />
  );
}

/** The footer form is no tab and no body section: the returned screen has it removed. */
export function useDetailScreenWithoutFooter(declaredScreen: ProjectionDetailScreenWithTarget): {
  readonly footerSection: EditWriteFormFooterSection | undefined;
  readonly screen: ProjectionDetailScreenWithTarget;
} {
  const footerSection = useMemo(
    () => declaredScreen.layout.sections.find(isFooterWriteForm),
    [declaredScreen.layout.sections],
  );
  const screen = useMemo(
    (): ProjectionDetailScreenWithTarget =>
      footerSection === undefined
        ? declaredScreen
        : {
            ...declaredScreen,
            layout: {
              ...declaredScreen.layout,
              sections: declaredScreen.layout.sections.filter(
                (section) => section !== footerSection,
              ),
            },
          },
    [declaredScreen, footerSection],
  );
  return { footerSection, screen };
}
