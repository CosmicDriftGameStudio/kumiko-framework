import type { EditWriteFormFooterSection } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useEffect, useState } from "react";
import {
  type DrawerLikeAction,
  type DrawerTargetScreen,
  useDrawerAction,
} from "./action-form-body.tsx";
import type { FeatureSchema } from "./feature-schema.ts";
import { isInPlaceFormAction } from "./projection-detail-inplace-form.tsx";
import { useUnsavedInputGuard } from "./unsaved-input-guard.tsx";
import { useWriteFormTracking } from "./use-write-form-tracking.ts";

type DrawerState = ReturnType<typeof useDrawerAction>;

type InPlaceForm = {
  readonly action: DrawerLikeAction;
  readonly screen: DrawerTargetScreen;
};

function inPlaceFormOf(drawer: DrawerState, scrollContentOnly: boolean): InPlaceForm | undefined {
  const { drawerAction, drawerScreen } = drawer;
  if (!scrollContentOnly || drawerAction === null || drawerScreen === undefined) return undefined;
  return isInPlaceFormAction(drawerAction, drawerScreen)
    ? { action: drawerAction, screen: drawerScreen }
    : undefined;
}

/** Drawer, in-place form and writeForm state of a projection detail, and the one discard question they share. */
export function useDetailDrawerState(input: {
  readonly schema: FeatureSchema;
  readonly scrollContentOnly: boolean;
  readonly footerSection: EditWriteFormFooterSection | undefined;
  readonly reloadDetail: () => Promise<void>;
  readonly onDirtyChange: ((dirty: boolean) => void) | undefined;
}) {
  const { schema, scrollContentOnly, footerSection, reloadDetail, onDirtyChange } = input;
  const drawer = useDrawerAction(schema);
  // Writing forms and a form shown in place both ask before the hosting drawer discards them.
  const [writeFormsDirty, setWriteFormsDirty] = useState(false);
  const { writeForms, dirtyWriteForms, reportWriteFormDirty } =
    useWriteFormTracking(setWriteFormsDirty);
  const inPlaceFormGuard = useUnsavedInputGuard(drawer.closeDrawer);
  // Esc, back, tab switch and Cancel of that form share one discard question (inPlaceFormGuard).
  const inPlaceForm = inPlaceFormOf(drawer, scrollContentOnly);
  const showsInPlaceForm = inPlaceForm !== undefined;
  const { openDrawer: openDrawerDirectly } = drawer;
  const { requestCloseThen } = inPlaceFormGuard;
  // A header or section action must not replace a form shown in place without asking.
  const openDrawer = useCallback(
    (...args: Parameters<typeof openDrawerDirectly>) => {
      if (showsInPlaceForm) requestCloseThen(() => openDrawerDirectly(...args));
      else openDrawerDirectly(...args);
    },
    [showsInPlaceForm, requestCloseThen, openDrawerDirectly],
  );
  // Only a submitted footer action carried the footer's values; a same-id drawer elsewhere did not.
  const reloadAfterDrawer = () => {
    const { drawerAction, drawerScreen } = drawer;
    const carriedFooterValues =
      drawerAction !== null &&
      drawerScreen?.type === "actionForm" &&
      footerSection?.actions?.some((action) => action === drawerAction) === true;
    if (carriedFooterValues) writeForms.get(drawerAction.id)?.rebase();
    return reloadDetail();
  };
  const anyUnsavedInput = writeFormsDirty || inPlaceFormGuard.hasUnsavedInput;
  useEffect(() => {
    onDirtyChange?.(anyUnsavedInput);
  }, [anyUnsavedInput, onDirtyChange]);
  return {
    drawer,
    openDrawer,
    inPlaceForm,
    inPlaceFormGuard,
    writeForms,
    dirtyWriteForms,
    reportWriteFormDirty,
    reloadAfterDrawer,
  };
}
