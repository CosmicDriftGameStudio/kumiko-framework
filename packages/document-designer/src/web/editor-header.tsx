// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { ModeSwitch, StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import { asRowStatus, statusLabel, statusTone } from "./status-label.ts";

export type EditorMode = "edit" | "preview";

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

export function EditorModeSwitch({
  testIdPrefix,
  mode,
  onMode,
}: {
  readonly testIdPrefix: string;
  readonly mode: EditorMode;
  readonly onMode: (mode: EditorMode) => void;
}): ReactNode {
  const t = useTranslation();
  return (
    <ModeSwitch<EditorMode>
      value={mode}
      onChange={onMode}
      ariaLabel={t("documentDesigner.mail.header.modeSwitch")}
      testId={`${testIdPrefix}-mode-switch`}
      options={[
        { value: "edit", label: t("documentDesigner.mail.header.edit") },
        { value: "preview", label: t("documentDesigner.mail.header.preview") },
      ]}
    />
  );
}

export function EditorLocaleSwitch({
  testIdPrefix,
  locales,
  locale,
  onLocale,
}: {
  readonly testIdPrefix: string;
  readonly locales: readonly string[];
  readonly locale: string;
  readonly onLocale: (locale: string) => void;
}): ReactNode {
  const t = useTranslation();
  return (
    <ModeSwitch<string>
      value={locale}
      onChange={onLocale}
      ariaLabel={t("documentDesigner.mail.header.localeSwitch")}
      testId={`${testIdPrefix}-locale-switch`}
      options={locales.map((code) => ({ value: code, label: code }))}
    />
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

export type EditorSaveActions = {
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly canPublish: boolean;
  readonly onSave: () => void;
  readonly onPublish: () => void;
};

// Title, status and the save/publish actions live in the shell header. The origin badge, the
// locale switch and the secondary action sit in the info bar below: at 1280px next to the
// sidebar, assistant and theme toggle the header has no room for them and the title would clip.
export function EditorHeader({
  title,
  stored,
  actions,
  children,
}: {
  readonly title: string;
  readonly stored: StoredVersion | null;
  readonly actions: EditorSaveActions;
  /** View controls left of the save actions (mode or kind switch). */
  readonly children: ReactNode;
}): ReactNode {
  const t = useTranslation();
  const { Button, PageHeader } = usePrimitives();
  if (PageHeader === undefined) return null;
  return (
    <PageHeader
      title={title}
      status={stored !== null && <StoredStatus stored={stored} />}
      actions={
        <span className="flex items-center gap-2 [&_button]:px-2.5 [&_button]:text-sm">
          {children}
          <Button
            variant="secondary"
            size="sm"
            disabled={!actions.canSave}
            loading={actions.busy}
            onClick={actions.onSave}
            testId="document-designer-header-save"
          >
            {t("documentDesigner.editor.save")}
          </Button>
          <Button
            size="sm"
            disabled={!actions.canPublish}
            onClick={actions.onPublish}
            testId="document-designer-header-publish"
          >
            {t("documentDesigner.editor.publish")}
          </Button>
        </span>
      }
    />
  );
}
