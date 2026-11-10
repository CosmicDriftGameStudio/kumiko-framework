import {
  DocumentContentEditor,
  type DocumentEditorHandle,
  type DocumentFrameControl,
  type DocumentResourcePreview,
  PDF_DOCUMENT_BLOCKS,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { LayoutHtml } from "./layout-html.tsx";
import { layoutValuesOf, type PdfLayoutMeta, pdfLayoutLookOf } from "./layout-meta.ts";
import { layoutRegionFlags, paperLookOf, paperSizeMm, resolveMarginsMm } from "./paper-geometry.ts";
import { PaperSheet } from "./paper-sheet.tsx";
import type { PdfMetaDraft } from "./pdf-meta.ts";
import type { LayoutRegionsHtml } from "./types.ts";

export type PageCanvasProps = {
  readonly meta: PdfMetaDraft;
  readonly layoutMeta: PdfLayoutMeta;
  readonly content: string;
  readonly onContentChange: (value: string) => void;
  readonly regions: LayoutRegionsHtml | null;
  readonly layoutName: string;
  readonly variableLabels: Readonly<Record<string, string>>;
  readonly systemVariables: readonly string[];
  readonly systemLabels: Readonly<Record<string, string>>;
  readonly variableNames: readonly string[];
  readonly imageVariables: readonly string[];
  readonly resourcePreviews: Readonly<Record<string, DocumentResourcePreview>>;
  readonly onEditorReady: (handle: DocumentEditorHandle | null) => void;
  readonly onFrameControlChange: (control: DocumentFrameControl | null) => void;
  readonly resourceSrc?: (key: string) => string | undefined;
};

function RegionBlock({
  html,
  systemLabels,
  resourceSrc,
  caption,
}: {
  html: string;
  systemLabels: Readonly<Record<string, string>>;
  resourceSrc: PageCanvasProps["resourceSrc"];
  caption: string;
}): ReactNode {
  if (html.trim() === "") return null;
  return (
    <div className="relative border border-dashed border-border bg-muted/40 p-2 pt-4 text-muted-foreground">
      <span className="absolute left-2 top-0.5 text-[10px] uppercase tracking-wide">{caption}</span>
      <LayoutHtml
        html={html}
        systemLabels={systemLabels}
        {...(resourceSrc !== undefined && { resourceSrc })}
      />
    </div>
  );
}

// The letterhead is a band across the whole paper, outside the page margins, like on printed letter paper.
function HeaderBand({
  html,
  systemLabels,
  resourceSrc,
  caption,
}: {
  html: string;
  systemLabels: Readonly<Record<string, string>>;
  resourceSrc: PageCanvasProps["resourceSrc"];
  caption: string;
}): ReactNode {
  return (
    <div
      className="absolute inset-x-0 top-0 min-h-(--paper-margin-top) border-b border-border bg-muted pt-[calc(4*var(--paper-mm))] pr-(--paper-margin-right) pb-[calc(2*var(--paper-mm))] pl-(--paper-margin-left) text-(length:--paper-font-size) text-foreground [&_td]:border-0! [&_th]:border-0! [&_p]:text-[length:inherit] [&_p]:leading-[inherit] [&_td]:align-middle [&_td:last-child]:whitespace-nowrap"
      data-testid="document-designer-letterhead"
    >
      <span className="absolute right-(--paper-margin-right) top-0.5 text-[9px] leading-none uppercase tracking-wide text-muted-foreground">
        {caption}
      </span>
      <LayoutHtml
        html={html}
        systemLabels={systemLabels}
        {...(resourceSrc !== undefined && { resourceSrc })}
      />
    </div>
  );
}

// Anchored to the bottom of page 1 (not the paper end: the sheet grows with long content), like the PDF footer region.
function FooterBand({
  html,
  systemLabels,
  resourceSrc,
  caption,
}: {
  html: string;
  systemLabels: Readonly<Record<string, string>>;
  resourceSrc: PageCanvasProps["resourceSrc"];
  caption: string;
}): ReactNode {
  return (
    <div
      className="absolute inset-x-0 top-(--paper-height) flex min-h-(--paper-margin-bottom) -translate-y-full flex-col border-t border-border bg-muted pt-[calc(1.5*var(--paper-mm))] pr-(--paper-margin-right) pb-[calc(2*var(--paper-mm))] pl-(--paper-margin-left) text-(length:--paper-font-size) text-foreground [&_td]:border-0! [&_th]:border-0! [&_p]:text-[length:inherit] [&_p]:leading-[inherit] [&_td]:align-middle [&_td:last-child]:whitespace-nowrap"
      data-testid="document-designer-footer-band"
    >
      <span className="mb-[calc(1*var(--paper-mm))] block text-[10px] leading-none uppercase tracking-wide text-muted-foreground">
        {caption}
      </span>
      <div className="mt-auto">
        <LayoutHtml
          html={html}
          systemLabels={systemLabels}
          {...(resourceSrc !== undefined && { resourceSrc })}
        />
      </div>
    </div>
  );
}

export function PageCanvas(props: PageCanvasProps): ReactNode {
  const t = useTranslation();
  const { meta } = props;
  const { showRegions, hasHeader, hasFooter } = layoutRegionFlags(
    meta.layoutHeaderFooter,
    props.regions,
  );
  // The letterhead band overlays the top margin; it never pushes the content down.
  const showLetterhead = hasHeader;
  const size = paperSizeMm(meta.pageFormat, meta.orientation);
  const margins = resolveMarginsMm({
    template: meta.margins,
    layout: props.layoutMeta.margins ?? {},
    hasHeader,
    hasFooter,
  });
  const fromLayout = t("documentDesigner.canvas.fromLayout", { layout: props.layoutName });
  const regionCaption = (region: "header" | "signature" | "footer"): string =>
    `${t(`documentDesigner.editor.region.${region}`)} · ${fromLayout}`;

  const renderPaper = (editable: ReactNode): ReactNode => (
    <div className="flex w-full flex-col items-center gap-2">
      <PaperSheet
        size={size}
        margins={margins}
        look={paperLookOf(pdfLayoutLookOf(props.layoutMeta))}
        testId="document-designer-page"
      >
        {showLetterhead && props.regions !== null && (
          <HeaderBand
            html={props.regions.header}
            systemLabels={props.systemLabels}
            resourceSrc={props.resourceSrc}
            caption={fromLayout}
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col pt-(--paper-margin-top) pr-(--paper-margin-right) pb-(--paper-margin-bottom) pl-(--paper-margin-left)">
          {/* No border, padding or position here: frames resolve against the paper and reserve their flow area from the top margin. */}
          <div
            className="min-h-0 flex-1 outline-1 outline-dashed outline-primary/40 outline-offset-4"
            data-testid="document-designer-content-area"
          >
            <span className="absolute top-[calc(var(--paper-margin-top)-0.75rem)] left-[calc(var(--paper-margin-left)+0.5rem)] z-10 bg-card px-1.5 text-[10px] leading-none uppercase tracking-wide text-primary">
              {t("documentDesigner.editor.region.content")}
            </span>
            {editable}
          </div>
          {showRegions && props.regions !== null && (
            <RegionBlock
              html={props.regions.signature}
              systemLabels={props.systemLabels}
              resourceSrc={props.resourceSrc}
              caption={regionCaption("signature")}
            />
          )}
        </div>
        {hasFooter && props.regions !== null && (
          <FooterBand
            html={props.regions.footer}
            systemLabels={props.systemLabels}
            resourceSrc={props.resourceSrc}
            caption={fromLayout}
          />
        )}
      </PaperSheet>
      <p className="text-xs text-muted-foreground">
        {t("documentDesigner.canvas.caption", { format: meta.pageFormat })}
      </p>
    </div>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="pdf-editor-center">
      <DocumentContentEditor
        id="document-designer-content"
        value={props.content}
        onChange={props.onContentChange}
        variables={props.variableNames}
        imageVariables={props.imageVariables}
        readOnly={false}
        blocks={PDF_DOCUMENT_BLOCKS}
        variableLabels={props.variableLabels}
        systemVariables={props.systemVariables}
        resourcePreviews={props.resourcePreviews}
        chrome="canvas"
        renderPaper={renderPaper}
        layoutValues={layoutValuesOf(pdfLayoutLookOf(props.layoutMeta))}
        onEditorReady={props.onEditorReady}
        onFrameControlChange={props.onFrameControlChange}
      />
    </div>
  );
}
