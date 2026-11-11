import { DocumentContentEditor } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { pluralKey, type Translate } from "@cosmicdrift/kumiko-renderer/headless";
import { cn } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import {
  footerColumnCount,
  PAPER_WIDTH_CLASS,
  REGION_EDITOR_IDS,
  type Region,
} from "./layout-editor-logic.ts";
import { layoutValuesOf } from "./layout-meta.ts";
import { paperLookOf, paperSizeMm, resolveMarginsMm } from "./paper-geometry.ts";
import { PaperSheet } from "./paper-sheet.tsx";
import type { LayoutEditorModel } from "./use-layout-editor-state.ts";

// A dashed, labelled area of the paper; the focused one owns the shared toolbar.
function PaperRegion({
  label,
  testId,
  children,
  active,
  className,
  onFocus,
}: {
  readonly label: string;
  readonly testId: string;
  readonly children: ReactNode;
  readonly active: boolean;
  readonly className?: string;
  readonly onFocus?: () => void;
}): ReactNode {
  return (
    <div
      className={cn(
        "relative rounded-sm p-3",
        active
          ? "border-[1.5px] border-solid border-primary bg-primary/5"
          : "border border-dashed border-input",
        className,
      )}
      data-testid={testId}
      data-active={active}
      onFocusCapture={onFocus}
    >
      <span
        className={cn(
          "absolute -top-2.5 left-2.5 bg-card px-1.5 text-[10px] uppercase tracking-wide",
          active ? "font-medium text-primary" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

// Chips at the draft's scale (8.5px on a 2.9 px/mm paper), so they stay proportional to the sheet.
const PAPER_SCALED_CHIPS_CLASS =
  "[&_[data-variable-chip]]:text-[length:calc(2.93*var(--paper-mm))] [&_[data-variable-chip]]:leading-[calc(4.14*var(--paper-mm))]";

function renderRegionEditor(
  m: LayoutEditorModel,
  region: Region,
  value: string,
  onChange: (next: string) => void,
): ReactNode {
  const { resourcePreviews } = m;
  return (
    <DocumentContentEditor
      id={REGION_EDITOR_IDS[region]}
      value={value}
      onChange={onChange}
      variables={m.placeholders}
      variableLabels={m.placeholderLabels}
      systemVariables={m.placeholders}
      readOnly={false}
      blocks={m.blocks}
      {...(resourcePreviews && { resourcePreviews })}
      {...(!m.isMail && { layoutValues: layoutValuesOf(m.pdfLook) })}
      chrome="canvas"
      onEditorReady={m.registerRegion(region)}
      toolbarHost={m.activeRegion === region ? m.toolbarHost : null}
    />
  );
}

function renderContentSlot(t: Translate, isMail: boolean): ReactNode {
  return (
    <div
      className={cn(
        "rounded-sm border-2 border-dashed border-primary bg-primary/10 px-3 text-center font-medium text-primary",
        isMail ? "py-9" : "flex min-h-40 flex-1 flex-col items-center justify-center py-9 text-sm",
      )}
      data-testid="document-designer-region-content"
    >
      ⊞ {t("documentDesigner.editor.region.content")}
      <small className="mt-1 block text-xs font-normal opacity-85">
        {t(isMail ? "documentDesigner.editor.slot.mail" : "documentDesigner.editor.slot.pdf")}
      </small>
    </div>
  );
}

function renderSignatureRegion(t: Translate, m: LayoutEditorModel): ReactNode {
  return (
    <PaperRegion
      label={t("documentDesigner.editor.region.signature")}
      testId="document-designer-region-signature"
      active={m.activeRegion === "signature"}
      onFocus={() => m.setActiveRegion("signature")}
    >
      {renderRegionEditor(m, "signature", m.signature, m.setSignature)}
    </PaperRegion>
  );
}

function footerLabel(t: Translate, m: LayoutEditorModel): string {
  const columns = m.isMail ? 0 : footerColumnCount(m.footer);
  const label =
    columns === 0
      ? t("documentDesigner.editor.region.footer")
      : t(pluralKey("documentDesigner.editor.region.footerColumns", columns), { count: columns });
  return !m.isMail && !m.pdfLook.footerOnFirstPage
    ? `${label} · ${t("documentDesigner.editor.region.fromPage2")}`
    : label;
}

// One sheet shows page 1, so a region that only prints from page 2 on is dimmed and labelled.
const SKIPPED_ON_FIRST_PAGE_CLASS = "opacity-50";

// The PDF footer sits 4 mm above the paper edge (CHROMIUM_REGION_PADDING_MM) at the page-margin columns, independent of the bottom margin.
const PDF_FOOTER_WRAPPER_CLASS =
  "absolute right-[calc(var(--paper-margin-right)-0.25rem)] bottom-[calc(4*var(--paper-mm))] left-[calc(var(--paper-margin-left)-0.25rem)] bg-card";

function renderFooterRegion(t: Translate, m: LayoutEditorModel): ReactNode {
  return (
    <div className={cn(m.isMail ? "-mx-8 -mb-6 bg-muted px-8 py-4" : PDF_FOOTER_WRAPPER_CLASS)}>
      <PaperRegion
        label={footerLabel(t, m)}
        testId="document-designer-region-footer"
        active={m.activeRegion === "footer"}
        className={cn(
          !m.isMail && "px-1 pt-1.5 pb-5",
          !m.isMail && PAPER_SCALED_CHIPS_CLASS,
          !m.isMail && !m.pdfLook.footerOnFirstPage && SKIPPED_ON_FIRST_PAGE_CLASS,
        )}
        onFocus={() => m.setActiveRegion("footer")}
      >
        {renderRegionEditor(m, "footer", m.footer, m.setFooter)}
      </PaperRegion>
    </div>
  );
}

function renderPdfPaper(t: Translate, m: LayoutEditorModel): ReactNode {
  const size = paperSizeMm("A4", "portrait");
  const margins = resolveMarginsMm({
    template: m.pdfLook.margins,
    layout: {},
    hasHeader: m.header.trim() !== "",
    hasFooter: m.footer.trim() !== "",
  });
  return (
    <div className="mx-auto flex w-full flex-col items-center">
      <PaperSheet
        size={size}
        margins={margins}
        look={paperLookOf(m.pdfLook)}
        testId="document-designer-paper"
      >
        {/* The PDF header text starts 4 mm (region padding) plus the line's leading below the paper edge, inside the top margin. */}
        <div className="absolute top-[calc(1*var(--paper-mm))] right-[calc(var(--paper-margin-right)-0.25rem)] left-[calc(var(--paper-margin-left)-0.25rem)] bg-card">
          <PaperRegion
            label={
              m.pdfLook.headerOnFirstPage
                ? t("documentDesigner.editor.region.header")
                : `${t("documentDesigner.editor.region.header")} · ${t("documentDesigner.editor.region.fromPage2")}`
            }
            testId="document-designer-region-header"
            active={m.activeRegion === "header"}
            className={cn(
              "px-1 pt-[calc(3*var(--paper-mm))] pb-1",
              PAPER_SCALED_CHIPS_CLASS,
              !m.pdfLook.headerOnFirstPage && SKIPPED_ON_FIRST_PAGE_CLASS,
            )}
            onFocus={() => m.setActiveRegion("header")}
          >
            {renderRegionEditor(m, "header", m.header, m.setHeader)}
          </PaperRegion>
        </div>
        <div className="flex min-h-0 flex-1 flex-col pt-(--paper-margin-top) pr-(--paper-margin-right) pb-(--paper-margin-bottom) pl-(--paper-margin-left)">
          {renderContentSlot(t, false)}
        </div>
        {renderFooterRegion(t, m)}
      </PaperSheet>
    </div>
  );
}

export function renderPaper(t: Translate, m: LayoutEditorModel): ReactNode {
  if (!m.isMail) return renderPdfPaper(t, m);
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-5 bg-card px-8 py-6 shadow-md",
        PAPER_WIDTH_CLASS[m.appearance.width],
        m.showAccentLine && "border-t-4 border-t-(--layout-accent)",
      )}
      ref={(element) => element?.style.setProperty("--layout-accent", m.accentColor)}
      data-testid="document-designer-paper"
    >
      <PaperRegion
        label={t("documentDesigner.editor.region.header")}
        testId="document-designer-region-header"
        active={m.activeRegion === "header"}
        onFocus={() => m.setActiveRegion("header")}
      >
        {renderRegionEditor(m, "header", m.header, m.setHeader)}
      </PaperRegion>
      {renderContentSlot(t, true)}
      {renderSignatureRegion(t, m)}
      {renderFooterRegion(t, m)}
    </div>
  );
}
