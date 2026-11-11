import type { EntityDefinition, PageHelpSpec } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import { fieldOptionHelpKey, fieldOptionLabelKey, type Translate } from "../headless/index.ts";
import { usePrimitives } from "../primitives.tsx";
import { statusToneForOptionTone, statusToneForValue } from "../status-tone.ts";

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
            const declaredTone = field.optionTones?.[value];
            const tone =
              (declaredTone !== undefined ? statusToneForOptionTone(declaredTone) : undefined) ??
              statusToneForValue(value) ??
              "muted";
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
  readonly entityName: string;
  readonly entity: PageHelpButtonProps["entity"] | undefined;
  readonly featureName: string;
  readonly translate: Translate;
};

/** The help button for a screen's `pageHelp`; `entityName` is the screen entity unless the spec names one. */
export function pageHelpButtonOf(
  spec: PageHelpSpec | undefined,
  context: PageHelpContext,
): ReactNode {
  if (spec === undefined || context.entity === undefined) return undefined;
  return (
    <PageHelpButton
      spec={spec}
      {...context}
      entityName={spec.entity ?? context.entityName}
      entity={context.entity}
    />
  );
}
