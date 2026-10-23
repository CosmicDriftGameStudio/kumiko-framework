import { DocumentContentEditor } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { cn } from "@cosmicdrift/kumiko-renderer/web";
import type { ReactNode } from "react";
import type { Translate } from "./layout-editor-logic.ts";
import { PAPER_WIDTH_CLASS, REGION_EDITOR_IDS, type Region } from "./layout-editor-logic.ts";
import type { LayoutEditorModel } from "./use-layout-editor-state.ts";

// A dashed, labelled area of the paper; the focused one owns the shared toolbar.
function PaperRegion({
  label,
  testId,
  children,
  onFocus,
}: {
  readonly label: string;
  readonly testId: string;
  readonly children: ReactNode;
  readonly onFocus?: () => void;
}): ReactNode {
  return (
    <div
      className="relative rounded-sm border border-dashed border-input p-3"
      data-testid={testId}
      onFocusCapture={onFocus}
    >
      <span className="absolute -top-2.5 left-2.5 bg-card px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

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
      chrome="canvas"
      toolbarHost={m.activeRegion === region ? m.toolbarHost : null}
    />
  );
}

function renderContentSlot(t: Translate, isMail: boolean): ReactNode {
  return (
    <div
      className="rounded-sm border-2 border-dashed border-primary bg-primary/10 px-3 py-9 text-center font-medium text-primary"
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
      onFocus={() => m.setActiveRegion("signature")}
    >
      {renderRegionEditor(m, "signature", m.signature, m.setSignature)}
    </PaperRegion>
  );
}

function renderFooterRegion(t: Translate, m: LayoutEditorModel): ReactNode {
  return (
    <div className={cn(m.isMail && "-mx-8 -mb-6 bg-muted px-8 py-4")}>
      <PaperRegion
        label={t("documentDesigner.editor.region.footer")}
        testId="document-designer-region-footer"
        onFocus={() => m.setActiveRegion("footer")}
      >
        {renderRegionEditor(m, "footer", m.footer, m.setFooter)}
      </PaperRegion>
    </div>
  );
}

export function renderPaper(t: Translate, m: LayoutEditorModel): ReactNode {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-5 bg-card px-8 py-6 shadow-md",
        m.isMail ? PAPER_WIDTH_CLASS[m.appearance.width] : "min-h-[842px] max-w-[595px]",
        m.showAccentLine && "border-t-4 border-t-(--layout-accent)",
      )}
      ref={(element) => element?.style.setProperty("--layout-accent", m.accentColor)}
      data-testid="document-designer-paper"
    >
      <PaperRegion
        label={t("documentDesigner.editor.region.header")}
        testId="document-designer-region-header"
        onFocus={() => m.setActiveRegion("header")}
      >
        {renderRegionEditor(m, "header", m.header, m.setHeader)}
      </PaperRegion>
      {renderContentSlot(t, m.isMail)}
      {m.isMail && renderSignatureRegion(t, m)}
      {renderFooterRegion(t, m)}
    </div>
  );
}
