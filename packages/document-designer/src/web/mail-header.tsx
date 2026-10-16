// @runtime client
import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { ModeSwitch, StatusBadge } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";
import type { TemplateRowView } from "./mail-types.js";
import { asRowStatus, statusLabel, statusTone } from "./status-label.js";

export type EditorMode = "edit" | "preview";

export type HeaderActions = {
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly canPublish: boolean;
  readonly onSave: () => void;
  readonly onPublish: () => void;
};

export function MailHeader({
  title,
  row,
  locales,
  locale,
  mode,
  testPending,
  actions,
  onBack,
  onLocale,
  onMode,
  onTestMail,
}: {
  readonly title: string;
  readonly row: TemplateRowView | null;
  readonly locales: readonly string[];
  readonly locale: string;
  readonly mode: EditorMode;
  readonly testPending: boolean;
  readonly actions: HeaderActions;
  readonly onBack: () => void;
  readonly onLocale: (locale: string) => void;
  readonly onMode: (mode: EditorMode) => void;
  readonly onTestMail: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Button, Heading, Link, Text } = usePrimitives();
  const status = row === null ? null : asRowStatus(row.status);
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="mail-editor-header">
      <Link href="#" onPress={onBack} testId="document-designer-back">
        {t("documentDesigner.editor.crumb")}
      </Link>
      <Text variant="muted">›</Text>
      <Heading variant="page" testId="document-designer-editor-title">
        {title}
      </Heading>
      {row !== null && status !== null && (
        <>
          <StatusBadge tone={statusTone(status)} testId="document-designer-editor-status">
            {statusLabel(t, status, row.version)}
          </StatusBadge>
          <StatusBadge
            tone={row.scope === "tenant" ? "accent" : "muted"}
            testId="document-designer-editor-origin"
          >
            {t(
              row.scope === "tenant"
                ? "documentDesigner.origin.tenant"
                : "documentDesigner.origin.system",
            )}
          </StatusBadge>
        </>
      )}
      <div className="grow" />
      <ModeSwitch<string>
        value={locale}
        onChange={onLocale}
        ariaLabel={t("documentDesigner.mail.header.localeSwitch")}
        testId="mail-locale-switch"
        options={locales.map((code) => ({ value: code, label: code }))}
      />
      <ModeSwitch<EditorMode>
        value={mode}
        onChange={onMode}
        ariaLabel={t("documentDesigner.mail.header.modeSwitch")}
        testId="mail-mode-switch"
        options={[
          { value: "edit", label: t("documentDesigner.mail.header.edit") },
          { value: "preview", label: t("documentDesigner.mail.header.preview") },
        ]}
      />
      <Button
        variant="secondary"
        disabled={testPending}
        loading={testPending}
        onClick={onTestMail}
        testId="mail-test-mail-header"
      >
        {t("documentDesigner.mail.header.testMail")}
      </Button>
      <Button
        variant="secondary"
        disabled={!actions.canSave}
        loading={actions.busy}
        onClick={actions.onSave}
        testId="mail-header-save"
      >
        {t("documentDesigner.editor.save")}
      </Button>
      <Button
        disabled={!actions.canPublish}
        onClick={actions.onPublish}
        testId="mail-header-publish"
      >
        {t("documentDesigner.editor.publish")}
      </Button>
    </div>
  );
}
