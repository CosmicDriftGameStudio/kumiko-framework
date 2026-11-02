import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { StatusBadge, EditorHeader as WorkbenchHeader } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import { asRowStatus, statusLabel, statusTone } from "./status-label.ts";

export type { EditorMode } from "@cosmicdrift/kumiko-renderer/web";
export { EditorLocaleSwitch, EditorModeSwitch } from "@cosmicdrift/kumiko-renderer/web";

/** "override" is a tenant row that replaces a system version; "tenant" has no system counterpart. */
export type EditorOrigin = "system" | "override" | "tenant";

const ORIGIN_LABEL: Readonly<Record<EditorOrigin, string>> = {
  system: "documentDesigner.origin.system",
  override: "documentDesigner.origin.override",
  tenant: "documentDesigner.source.tenant",
};

export function originOf(isSystemRow: boolean, hasSystemVersion: boolean): EditorOrigin {
  return isSystemRow ? "system" : hasSystemVersion ? "override" : "tenant";
}

export function OriginBadge({ origin }: { readonly origin: EditorOrigin }): ReactNode {
  const t = useTranslation();
  return (
    <StatusBadge
      tone={origin === "system" ? "muted" : "accent"}
      testId="document-designer-editor-origin"
    >
      {t(ORIGIN_LABEL[origin])}
    </StatusBadge>
  );
}

export type StoredVersion = {
  readonly status: string;
  readonly version: number;
};

function StoredStatus({ stored }: { readonly stored: StoredVersion }): ReactNode {
  const t = useTranslation();
  const status = asRowStatus(stored.status);
  return (
    <StatusBadge tone={statusTone(status)} testId="document-designer-editor-status">
      {statusLabel(t, status, stored.version)}
    </StatusBadge>
  );
}

export type DesignerSaveActions = {
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly canPublish: boolean;
  readonly onSave: () => void;
  readonly onPublish: () => void;
};

const DESIGNER_HEADER_TEST_IDS = {
  save: "document-designer-header-save",
  publish: "document-designer-header-publish",
} as const;

export function EditorHeader({
  title,
  stored,
  actions,
  children,
}: {
  readonly title: string;
  readonly stored: StoredVersion | null;
  readonly actions: DesignerSaveActions;
  /** View controls left of the save actions (mode or kind switch). */
  readonly children: ReactNode;
}): ReactNode {
  return (
    <WorkbenchHeader
      title={title}
      status={stored !== null && <StoredStatus stored={stored} />}
      actions={actions}
      testIds={DESIGNER_HEADER_TEST_IDS}
    >
      {children}
    </WorkbenchHeader>
  );
}
