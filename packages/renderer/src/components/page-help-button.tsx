import type { EntityDefinition, PageHelpSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { parseRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import type { FeatureSchema } from "../app/feature-schema.ts";
import { fieldOptionHelpKey, fieldOptionLabelKey, type Translate } from "../headless/index.ts";
import { usePrimitives } from "../primitives.tsx";
import { statusToneForOption } from "../status-tone.ts";

export type PageHelpButtonProps = {
  readonly spec: PageHelpSpec;
  readonly entityName: string;
  readonly entity: Pick<EntityDefinition, "fields">;
  readonly featureName: string;
  readonly translate: Translate;
};

export function PageHelpButton({
  spec,
  entityName,
  entity,
  featureName,
  translate,
}: PageHelpButtonProps): ReactNode {
  const { Button, Dialog, Grid, GridCell, Text, StatusBadge } = usePrimitives();
  const [open, setOpen] = useState(false);
  const field = entity.fields[spec.statusField];
  if (field === undefined || field.type !== "select") return null;
  const buttonLabel = translate("kumiko.pageHelp.button");
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon="help-circle"
        onClick={() => setOpen(true)}
        testId="page-help-button"
      >
        {buttonLabel}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={translate("kumiko.pageHelp.title")}
        confirmLabel={translate("kumiko.dialog.close")}
        hideCancel
        initialFocus="confirm"
        onConfirm={() => undefined}
        testId="page-help-dialog"
      >
        <Grid columns={1} testId="page-help-options">
          {field.options.map((value) => {
            const label = translate(
              fieldOptionLabelKey(featureName, entityName, spec.statusField, value),
            );
            const tone = statusToneForOption(value, field.optionTones) ?? "muted";
            return (
              <Grid columns={3} key={value} testId={`page-help-option-${value}`}>
                <GridCell span={1}>
                  {StatusBadge !== undefined ? (
                    <StatusBadge value={label} tone={tone} testId={`page-help-badge-${value}`} />
                  ) : (
                    <Text testId={`page-help-badge-${value}`}>{label}</Text>
                  )}
                </GridCell>
                <GridCell span={2}>
                  <Text variant="muted" testId={`page-help-text-${value}`}>
                    {translate(
                      fieldOptionHelpKey(featureName, entityName, spec.statusField, value),
                    )}
                  </Text>
                </GridCell>
              </Grid>
            );
          })}
        </Grid>
      </Dialog>
    </>
  );
}

export type PageHelpContext = {
  /** Entity used when the spec names none; may be empty on a projectionDetail. */
  readonly entityName: string;
  /** Entity of `entityName` in the screen's own feature, used when `appFeatures` does not know it. */
  readonly entity: PageHelpButtonProps["entity"] | undefined;
  readonly featureName: string;
  readonly translate: Translate;
  readonly appFeatures: readonly FeatureSchema[];
};

/** The help button for a `pageHelp`; the entity is `spec.entity` (bare or `<feature>:<entity>`), else the context entity.
 *  Labels and help texts come from the feature owning the entity. */
export function pageHelpButtonOf(
  spec: PageHelpSpec | undefined,
  context: PageHelpContext,
): ReactNode {
  if (spec === undefined) return undefined;
  const target = parseRefTarget(spec.entity ?? context.entityName, context.featureName);
  const contextTarget = parseRefTarget(context.entityName, context.featureName);
  const ownsContextEntity =
    target.featureName === contextTarget.featureName &&
    target.entityName === contextTarget.entityName;
  const entity =
    context.appFeatures.find((f) => f.featureName === target.featureName)?.entities[
      target.entityName
    ] ?? (ownsContextEntity ? context.entity : undefined);
  if (entity === undefined) return undefined;
  return (
    <PageHelpButton
      spec={spec}
      entityName={target.entityName}
      entity={entity}
      featureName={target.featureName}
      translate={context.translate}
    />
  );
}

/** Puts the page help in front of the other header actions. */
export function withPageHelp(pageHelp: ReactNode, actions: ReactNode): ReactNode {
  if (pageHelp === undefined) return actions;
  return (
    <>
      {pageHelp}
      {actions}
    </>
  );
}
