import type { PageHeaderProps } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { usePageHeaderSlot } from "../layout/page-header-slot.js";

export function DefaultPageHeader({
  title,
  recordTitle,
  status,
  actions,
  overflowItems,
  hideBreadcrumb,
}: PageHeaderProps): ReactNode {
  const slot = usePageHeaderSlot();
  const setOverflowItems = slot?.setOverflowItems;
  const setTitle = slot?.setTitle;
  const setRecordTitle = slot?.setRecordTitle;
  const setBreadcrumbHidden = slot?.setBreadcrumbHidden;

  useEffect(() => {
    if (setBreadcrumbHidden === undefined || hideBreadcrumb !== true) return;
    setBreadcrumbHidden(true);
    return () => setBreadcrumbHidden(false);
  }, [setBreadcrumbHidden, hideBreadcrumb]);

  useEffect(() => {
    if (setRecordTitle === undefined || recordTitle === undefined) return;
    setRecordTitle(recordTitle);
    return () => setRecordTitle(undefined);
  }, [setRecordTitle, recordTitle]);

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
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </div>
    );
  }
  return (
    <>
      {status !== undefined &&
        slot.statusElement !== null &&
        createPortal(status, slot.statusElement)}
      {actions !== undefined &&
        slot.actionsElement !== null &&
        createPortal(actions, slot.actionsElement)}
    </>
  );
}
