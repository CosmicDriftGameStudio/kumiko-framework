import { type ReactNode, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import type { PageHeaderProps } from "../../index.ts";
import { usePageHeaderSlot } from "../layout/page-header-slot.tsx";
import { UNIFORM_BAR_CONTROLS_CLASSES } from "../layout/uniform-bar-controls.ts";
import { cn } from "../lib/cn.ts";

export function DefaultPageHeader({
  title,
  recordTitle,
  narrowRecordTitle,
  status,
  help,
  actions,
  bodyTitle,
  overflowItems,
  hideBreadcrumb,
  breadcrumbScreenId,
}: PageHeaderProps): ReactNode {
  const slot = usePageHeaderSlot();
  const setOverflowItems = slot?.setOverflowItems;
  const setTitle = slot?.setTitle;
  const setRecordTitle = slot?.setRecordTitle;
  const setNarrowRecordTitle = slot?.setNarrowRecordTitle;
  const setBodyTitle = slot?.setBodyTitle;
  const setBreadcrumbHidden = slot?.setBreadcrumbHidden;
  const setBreadcrumbScreenId = slot?.setBreadcrumbScreenId;

  useEffect(() => {
    if (setBreadcrumbHidden === undefined || hideBreadcrumb !== true) return;
    setBreadcrumbHidden(true);
    return () => setBreadcrumbHidden(false);
  }, [setBreadcrumbHidden, hideBreadcrumb]);

  useEffect(() => {
    if (setBreadcrumbScreenId === undefined || breadcrumbScreenId === undefined) return;
    setBreadcrumbScreenId(breadcrumbScreenId);
    return () => setBreadcrumbScreenId(undefined);
  }, [setBreadcrumbScreenId, breadcrumbScreenId]);

  // Layout effect: a passive one lets the shell paint its own h1 next to the body's for a frame.
  useLayoutEffect(() => {
    if (setBodyTitle === undefined || bodyTitle !== true) return;
    setBodyTitle(true);
    return () => setBodyTitle(false);
  }, [setBodyTitle, bodyTitle]);

  useEffect(() => {
    if (setRecordTitle === undefined || recordTitle === undefined) return;
    setRecordTitle(recordTitle);
    return () => setRecordTitle(undefined);
  }, [setRecordTitle, recordTitle]);

  useEffect(() => {
    if (setNarrowRecordTitle === undefined || narrowRecordTitle === undefined) return;
    setNarrowRecordTitle(narrowRecordTitle);
    return () => setNarrowRecordTitle(undefined);
  }, [setNarrowRecordTitle, narrowRecordTitle]);

  useEffect(() => {
    if (setTitle === undefined || title === undefined) return;
    setTitle(title);
    return () => setTitle(undefined);
  }, [setTitle, title]);

  // Without a slot no caller passes overflowItems: screens only render a
  // PageHeader below a shell that offers one.
  useEffect(() => {
    if (setOverflowItems === undefined || overflowItems === undefined) return;
    setOverflowItems(overflowItems);
    return () => setOverflowItems(undefined);
  }, [setOverflowItems, overflowItems]);

  if (slot === null) {
    return (
      <div data-kumiko-layout="page-header-inline" className="flex items-center gap-2 px-4 py-2">
        {status}
        <div className={cn("ml-auto flex items-center gap-2", UNIFORM_BAR_CONTROLS_CLASSES)}>
          {actions}
          {help}
        </div>
      </div>
    );
  }
  return (
    <>
      {status !== undefined &&
        slot.statusElement !== null &&
        createPortal(status, slot.statusElement)}
      {(actions !== undefined || help !== undefined) &&
        slot.actionsElement !== null &&
        createPortal(
          <>
            {actions}
            {help}
          </>,
          slot.actionsElement,
        )}
    </>
  );
}
