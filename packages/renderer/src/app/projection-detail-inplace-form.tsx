import { type ReactNode, useCallback, useEffect, useRef } from "react";
import type { Translate } from "../headless/index.ts";
import { useLocale, useTranslation } from "../i18n.tsx";
import {
  DrawerCloseRequestProvider,
  InPlaceFormProvider,
  useDrawerEscapeHandler,
} from "../inside-drawer.ts";
import { usePrimitives } from "../primitives.tsx";
import {
  DrawerActionContent,
  type DrawerLikeAction,
  type DrawerTargetScreen,
  resolveDrawerHeading,
} from "./action-form-body.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { UnsavedInputDialog, type UnsavedInputGuard } from "./unsaved-input-guard.tsx";

/** A drawer-kind action with `back` opened from a detail that already sits in a drawer: its form takes the place of the tab content instead of stacking a second drawer. */
export function isInPlaceFormAction(action: DrawerLikeAction, screen: DrawerTargetScreen): boolean {
  return "back" in action && action.back === true && screen.type === "actionForm";
}

export function InPlaceActionForm({
  schema,
  action,
  screen,
  initialValues,
  headingValues,
  translate,
  userRoles,
  guard,
  onSubmitted,
}: {
  readonly schema: FeatureSchema;
  readonly action: DrawerLikeAction;
  readonly screen: DrawerTargetScreen;
  readonly initialValues: Readonly<Record<string, unknown>> | undefined;
  readonly headingValues: Readonly<Record<string, unknown>> | undefined;
  readonly translate: Translate | undefined;
  readonly userRoles: readonly string[] | undefined;
  readonly guard: UnsavedInputGuard;
  /** The form saved: the host closes it and reloads the detail. */
  readonly onSubmitted: () => void;
}): ReactNode {
  const { Button, FillContainer } = usePrimitives();
  const t = useTranslation();
  const locale = useLocale().locale();
  const backRef = useRef<HTMLButtonElement>(null);
  const { requestClose, setHasUnsavedInput } = guard;
  const consumeEscape = useCallback(() => {
    requestClose();
    return true;
  }, [requestClose]);
  useDrawerEscapeHandler(consumeEscape);
  useEffect(() => backRef.current?.focus(), []);
  const heading = resolveDrawerHeading({
    action,
    translate: translate ?? t,
    locale,
    headingValues,
    initialValues,
  });
  const testId = `toolbar-drawer-${action.id}`;
  return (
    <InPlaceFormProvider value={true}>
      <FillContainer grow restoreFocus className="min-w-0" testId={testId}>
        <FillContainer
          className="shrink-0 flex-row items-center gap-3 px-6 pt-4 max-sm:px-4"
          testId={`${testId}-header`}
        >
          <Button
            variant="secondary"
            size="icon"
            icon="chevron-left"
            ariaLabel={t("kumiko.actions.back")}
            onClick={requestClose}
            ref={backRef}
          />
          <FillContainer className="min-w-0 flex-row flex-wrap items-baseline gap-x-3">
            <FillContainer className="text-base font-semibold">{heading.title}</FillContainer>
            {heading.subtitle !== undefined && (
              <FillContainer className="text-sm text-muted-foreground">
                {heading.subtitle}
              </FillContainer>
            )}
          </FillContainer>
        </FillContainer>
        <FillContainer grow testId={`${testId}-body`}>
          <DrawerCloseRequestProvider value={requestClose}>
            <DrawerActionContent
              schema={schema}
              drawerAction={action}
              drawerScreen={screen}
              {...(initialValues !== undefined && { drawerInitialValues: initialValues })}
              userRoles={userRoles}
              {...(translate !== undefined && { translate })}
              onDirtyChange={setHasUnsavedInput}
              onFormSuccess={() => {
                setHasUnsavedInput(false);
                onSubmitted();
              }}
              showCancel
            />
          </DrawerCloseRequestProvider>
        </FillContainer>
        <UnsavedInputDialog guard={guard} />
      </FillContainer>
    </InPlaceFormProvider>
  );
}
