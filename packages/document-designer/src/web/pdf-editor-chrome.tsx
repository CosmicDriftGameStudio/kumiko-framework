import type { ReactNode } from "react";
import { EditorHeader, EditorLocaleSwitch, EditorModeSwitch, originOf } from "./editor-header.tsx";
import { EditorFooter, EditorInfoBar } from "./editor-shell.tsx";
import { OverridesDrawer } from "./overrides-drawer.tsx";
import type { PdfRenderContext } from "./pdf-editor-context.ts";

export function renderPdfHeader(c: PdfRenderContext): ReactNode {
  const { s, view, detail, actions } = c;
  const { busy, mode, setMode } = s.ui;
  return (
    <EditorHeader
      title={view.title}
      stored={{ status: detail.status, version: detail.version }}
      actions={{
        busy: busy === "save",
        canSave: busy === null && s.server.validation?.canSave !== false,
        canPublish: busy === null && view.canPublish,
        onSave: () => void actions.save(),
        onPublish: () => void actions.publish(),
      }}
    >
      <EditorModeSwitch testIdPrefix="pdf" mode={mode} onMode={setMode} />
    </EditorHeader>
  );
}

function renderInfoControls(c: PdfRenderContext): ReactNode {
  const { t, Button, s, view, actions } = c;
  const { busy, mode } = s.ui;
  const { locale, locales } = s.doc;
  return (
    <>
      <EditorLocaleSwitch
        testIdPrefix="pdf"
        locales={locales.length > 0 ? locales : [locale]}
        locale={locale}
        onLocale={actions.requestLocale}
      />
      {mode === "preview" && (
        <Button
          variant="secondary"
          disabled={!view.pdfAvailable || busy !== null}
          loading={busy === "pdf"}
          onClick={() => void actions.generatePdf()}
          testId="pdf-generate-header"
        >
          {t("documentDesigner.actions.generatePdf")}
        </Button>
      )}
    </>
  );
}

function renderOverrideLinks(c: PdfRenderContext): ReactNode {
  const { t, Button, s, view } = c;
  return (
    view.showOverrideLinks && (
      <>
        <Button variant="link" onClick={() => void c.exportBundle()}>
          {t("documentDesigner.originBar.export")}
        </Button>
        <Button variant="link" onClick={() => s.ui.setOverridesOpen(true)}>
          {t("documentDesigner.originBar.showOverrides")}
        </Button>
      </>
    )
  );
}

function renderUnavailableNote(c: PdfRenderContext): ReactNode {
  const { t, view } = c;
  return (
    view.pdfUnavailableNote && (
      <>
        {" "}
        <span data-testid="pdf-unavailable">
          {view.unavailableMessage === ""
            ? t("documentDesigner.pdfUnavailableNoReason")
            : t("documentDesigner.pdfUnavailable", { message: view.unavailableMessage })}
        </span>
      </>
    )
  );
}

export function renderPdfInfoBar(c: PdfRenderContext): ReactNode {
  const { s, view, detail, slug } = c;
  const { overridesOpen, setOverridesOpen } = s.ui;
  return (
    <EditorInfoBar
      tone={view.pdfUnavailableNote ? "warn" : detail.scope === "tenant" ? "active" : "muted"}
      testId="pdf-origin-bar"
      origin={originOf(detail.scope === "system", view.systemVersion !== null)}
      controls={renderInfoControls(c)}
      overlays={
        <OverridesDrawer
          open={overridesOpen}
          onOpenChange={setOverridesOpen}
          slug={slug}
          locale={s.doc.locale}
          overrides={s.server.overridesQuery.data}
        />
      }
      links={renderOverrideLinks(c)}
    >
      {view.originText}
      {view.besideActiveSentence !== null && ` ${view.besideActiveSentence}`}
      {renderUnavailableNote(c)}
    </EditorInfoBar>
  );
}

export function renderPdfFooter(c: PdfRenderContext): ReactNode {
  const { s, view, detail, actions } = c;
  const { busy } = s.ui;
  return (
    <EditorFooter
      testIdPrefix="pdf-editor"
      message={view.footer}
      saveError={s.ui.actionError}
      modifiedAt={detail.modifiedAt ?? null}
      dirty={view.dirty}
      busy={busy === "save"}
      canSave={busy === null && s.server.validation?.canSave !== false}
      canPublish={busy === null && view.canPublish}
      onDiscard={() => actions.resetDraft(detail)}
      onSave={() => void actions.save()}
      onPublish={() => void actions.publish()}
    />
  );
}

export function renderPdfLocaleDialog(c: PdfRenderContext): ReactNode {
  const { t, Button, Dialog, s, actions, detail, onLocaleChange } = c;
  const { pendingLocale, setPendingLocale } = s.ui;
  return (
    <Dialog
      open={pendingLocale !== null}
      onOpenChange={(open) => {
        if (!open) setPendingLocale(null);
      }}
      title={t("documentDesigner.localeDialog.title")}
      description={t("documentDesigner.localeDialog.description")}
      confirmLabel={t("documentDesigner.localeDialog.save")}
      cancelLabel={t("documentDesigner.localeDialog.cancel")}
      onConfirm={async () => {
        const target = pendingLocale;
        if (target !== null && (await actions.save())) onLocaleChange?.(target);
        setPendingLocale(null);
      }}
    >
      <Button
        variant="danger-ghost"
        onClick={() => {
          const target = pendingLocale;
          setPendingLocale(null);
          actions.resetDraft(detail);
          if (target !== null) onLocaleChange?.(target);
        }}
      >
        {t("documentDesigner.localeDialog.discard")}
      </Button>
    </Dialog>
  );
}
