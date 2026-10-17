// @runtime client
import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  formatWhen,
  useMutation,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { originOf } from "./editor-header.js";
import { EditorInfoBar } from "./editor-shell.js";
import type { TemplateRowView } from "./mail-types.js";
import { DiffDrawer } from "./origin-bar.js";
import { draftBesideActiveSentence } from "./status-label.js";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export function languageName(t: Translate, locale: string): string {
  const key = `documentDesigner.mail.language.${locale}`;
  const translated = t(key);
  return translated === key ? locale : translated;
}

function statusSentence(t: Translate, row: TemplateRowView): string {
  const besideActive = draftBesideActiveSentence(t, row);
  if (besideActive !== null) return besideActive;
  if (row.status === "active") {
    return t("documentDesigner.mail.origin.activeSince", {
      when: row.modifiedAt === null ? "–" : formatWhen(row.modifiedAt),
    });
  }
  return t(
    row.status === "archived"
      ? "documentDesigner.mail.origin.archived"
      : "documentDesigner.mail.origin.notPublished",
  );
}

function MissingLocaleBar({
  locale,
  creating,
  controls,
}: {
  readonly locale: string;
  readonly creating: boolean;
  readonly controls: ReactNode;
}): ReactNode {
  const t = useTranslation();
  return creating ? (
    <EditorInfoBar tone="muted" testId="mail-origin-bar" controls={controls}>
      {t("documentDesigner.mail.origin.creating", { language: languageName(t, locale) })}
    </EditorInfoBar>
  ) : (
    <EditorInfoBar tone="warn" testId="mail-origin-bar" controls={controls}>
      {t("documentDesigner.mail.origin.missing", { language: languageName(t, locale) })}
    </EditorInfoBar>
  );
}

function TenantOriginBar({
  row,
  systemVersion,
  controls,
  onReset,
}: {
  readonly row: TemplateRowView;
  readonly systemVersion: number | null;
  readonly controls: ReactNode;
  readonly onReset: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Button, Dialog } = usePrimitives();
  const [diffOpen, setDiffOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const resetToSystem = useMutation(TemplateResolverHandlers.resetToSystem);
  const hasSystem = systemVersion !== null;
  return (
    <EditorInfoBar
      tone="active"
      testId="mail-origin-bar"
      origin={originOf(false, hasSystem)}
      controls={controls}
      overlays={
        <>
          {diffOpen && <DiffDrawer tenantId={row.id} onClose={() => setDiffOpen(false)} />}
          <Dialog
            open={resetOpen}
            onOpenChange={setResetOpen}
            title={t("documentDesigner.mail.reset.title")}
            description={t("documentDesigner.mail.reset.description")}
            confirmLabel={t("documentDesigner.mail.reset.confirm")}
            variant="danger"
            onConfirm={async () => {
              const result = await resetToSystem.mutate({ id: row.id });
              if (result.isSuccess) onReset();
            }}
          />
        </>
      }
      links={
        hasSystem && (
          <>
            <Button
              variant="link"
              onClick={() => setDiffOpen(true)}
              testId="document-designer-diff-open"
            >
              {t("documentDesigner.editor.diff.open")}
            </Button>
            <Button
              variant="link"
              onClick={() => setResetOpen(true)}
              testId="document-designer-reset-open"
            >
              {t("documentDesigner.mail.origin.reset")}
            </Button>
          </>
        )
      }
    >
      {hasSystem
        ? t("documentDesigner.mail.origin.overrides", { version: systemVersion })
        : t("documentDesigner.mail.origin.tenantOnly")}{" "}
      {statusSentence(t, row)}
    </EditorInfoBar>
  );
}

export function MailOriginBar({
  row,
  systemVersion,
  locale,
  isSystemAdmin,
  creating,
  controls,
  onReload,
}: {
  readonly row: TemplateRowView | null;
  readonly systemVersion: number | null;
  readonly locale: string;
  readonly isSystemAdmin: boolean;
  readonly creating: boolean;
  readonly controls: ReactNode;
  readonly onReload: () => void;
}): ReactNode {
  const t = useTranslation();
  if (row === null) {
    return <MissingLocaleBar locale={locale} creating={creating} controls={controls} />;
  }
  if (row.scope === "tenant") {
    return (
      <TenantOriginBar
        row={row}
        systemVersion={systemVersion}
        controls={controls}
        onReset={onReload}
      />
    );
  }
  return (
    <EditorInfoBar tone="muted" testId="mail-origin-bar" origin="system" controls={controls}>
      {t(
        isSystemAdmin
          ? "documentDesigner.mail.origin.platform"
          : "documentDesigner.mail.origin.system",
        { version: row.version },
      )}
    </EditorInfoBar>
  );
}
