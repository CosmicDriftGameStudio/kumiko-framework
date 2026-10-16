// @runtime client
import { TemplateResolverHandlers } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import {
  dispatcherErrorText,
  formatWhen,
  useMutation,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import type { TemplateRowView } from "./mail-types.js";
import { DiffPanel } from "./origin-bar.js";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export function languageName(t: Translate, locale: string): string {
  const key = `documentDesigner.mail.language.${locale}`;
  const translated = t(key);
  return translated === key ? locale : translated;
}

function statusSentence(t: Translate, row: TemplateRowView): string {
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

const BAR_CLASS = "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-4 py-2.5";

function MissingLocaleBar({
  slug,
  locale,
  fallbackLocale,
  copyScope,
  creating,
  onCreateBlank,
  onCopied,
}: {
  readonly slug: string;
  readonly locale: string;
  readonly fallbackLocale: string | null;
  readonly copyScope: "tenant" | "system";
  readonly creating: boolean;
  readonly onCreateBlank: () => void;
  readonly onCopied: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Banner, Button, Text } = usePrimitives();
  const copyLocale = useMutation(TemplateResolverHandlers.copyLocale);
  const [error, setError] = useState<string | null>(null);

  if (creating) {
    return (
      <div className={`${BAR_CLASS} bg-muted`} data-testid="mail-origin-bar">
        <Text>
          {t("documentDesigner.mail.origin.creating", { language: languageName(t, locale) })}
        </Text>
      </div>
    );
  }
  const copy = async (from: string): Promise<void> => {
    setError(null);
    const result = await copyLocale.mutate({
      slug,
      kind: "mail",
      fromLocale: from,
      toLocale: locale,
      overwrite: false,
      scope: copyScope,
    });
    if (result.isSuccess) onCopied();
    else setError(dispatcherErrorText(result.error, t));
  };
  return (
    <div
      className={`${BAR_CLASS} border-status-warn bg-status-warn-surface`}
      data-testid="mail-origin-bar"
      data-variant="warn"
    >
      <Text>
        {t(
          fallbackLocale === null
            ? "documentDesigner.mail.origin.missingNoFallback"
            : "documentDesigner.mail.origin.missing",
          {
            language: languageName(t, locale),
            locale,
            fallback: fallbackLocale ?? "",
          },
        )}
        {fallbackLocale !== null && ` ${t("documentDesigner.mail.origin.copyNote")}`}
      </Text>
      <div className="grow" />
      {fallbackLocale !== null && (
        <Button
          size="sm"
          variant="secondary"
          loading={copyLocale.pending}
          onClick={() => copy(fallbackLocale)}
          testId="mail-copy-locale"
        >
          {t("documentDesigner.mail.origin.copyFrom", { fallback: fallbackLocale })}
        </Button>
      )}
      <Button size="sm" variant="secondary" onClick={onCreateBlank} testId="mail-create-blank">
        {t("documentDesigner.mail.origin.createBlank")}
      </Button>
      {error !== null && (
        <Banner variant="error" testId="mail-copy-error">
          {error}
        </Banner>
      )}
    </div>
  );
}

function TenantOriginBar({
  row,
  title,
  systemVersion,
  onReset,
}: {
  readonly row: TemplateRowView;
  readonly title: string;
  readonly systemVersion: number | null;
  readonly onReset: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Button, Dialog, Drawer, Modal, Text } = usePrimitives();
  const [diffOpen, setDiffOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const resetToSystem = useMutation(TemplateResolverHandlers.resetToSystem);
  const hasSystem = systemVersion !== null;
  const diffTitle = t("documentDesigner.editor.diff.title");
  const diffBody = <DiffPanel tenantId={row.id} />;
  return (
    <div className={`${BAR_CLASS} bg-muted`} data-testid="mail-origin-bar">
      <Text>
        {hasSystem
          ? t("documentDesigner.mail.origin.overrides", { title, version: systemVersion })
          : t("documentDesigner.mail.origin.tenantOnly")}{" "}
        {statusSentence(t, row)}
      </Text>
      <div className="grow" />
      {hasSystem && (
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
      )}
      {diffOpen &&
        (Drawer === undefined ? (
          <Modal open onOpenChange={setDiffOpen} title={diffTitle}>
            {diffBody}
          </Modal>
        ) : (
          <Drawer open onOpenChange={setDiffOpen} title={diffTitle}>
            {diffBody}
          </Drawer>
        ))}
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
    </div>
  );
}

export function MailOriginBar({
  row,
  title,
  systemVersion,
  slug,
  locale,
  fallbackLocale,
  isSystemAdmin,
  creating,
  onCreateBlank,
  onReload,
}: {
  readonly row: TemplateRowView | null;
  readonly title: string;
  readonly systemVersion: number | null;
  readonly slug: string;
  readonly locale: string;
  readonly fallbackLocale: string | null;
  readonly isSystemAdmin: boolean;
  readonly creating: boolean;
  readonly onCreateBlank: () => void;
  readonly onReload: () => void;
}): ReactNode {
  const t = useTranslation();
  const { Text } = usePrimitives();
  if (row === null) {
    return (
      <MissingLocaleBar
        slug={slug}
        locale={locale}
        fallbackLocale={fallbackLocale}
        copyScope={isSystemAdmin ? "system" : "tenant"}
        creating={creating}
        onCreateBlank={onCreateBlank}
        onCopied={onReload}
      />
    );
  }
  if (row.scope === "tenant") {
    return (
      <TenantOriginBar row={row} title={title} systemVersion={systemVersion} onReset={onReload} />
    );
  }
  return (
    <div className={`${BAR_CLASS} bg-muted`} data-testid="mail-origin-bar">
      <Text>
        {t(
          isSystemAdmin
            ? "documentDesigner.mail.origin.platform"
            : "documentDesigner.mail.origin.system",
          { version: row.version },
        )}
      </Text>
    </div>
  );
}
