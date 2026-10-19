// @runtime client
import {
  DocumentContentEditor,
  type DocumentEditorHandle,
  type DocumentResourcePreview,
  PDF_DEFAULT_MARGIN_MM,
  PDF_DOCUMENT_BLOCKS,
  PDF_FOOTER_MARGIN_MM,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { cn } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useCallback } from "react";
import { LayoutHtml } from "./layout-html.tsx";
import { MARGIN_SIDES, type PdfMetaDraft } from "./pdf-meta.ts";
import type { LayoutRegionsHtml } from "./types.ts";

const MM_TO_PX = 96 / 25.4;

// Page width in CSS px at 96 dpi as a cap; the page shrinks with a narrow column instead of scrolling sideways.
const PAGE_WIDTH_CLASSES: Readonly<Record<string, string>> = {
  "A4-portrait": "max-w-[794px]",
  "A4-landscape": "max-w-[1123px]",
  "Letter-portrait": "max-w-[816px]",
  "Letter-landscape": "max-w-[1056px]",
};

export type PageCanvasProps = {
  readonly meta: PdfMetaDraft;
  readonly content: string;
  readonly onContentChange: (value: string) => void;
  readonly regions: LayoutRegionsHtml | null;
  readonly layoutName: string;
  readonly variableLabels: Readonly<Record<string, string>>;
  readonly systemVariables: readonly string[];
  readonly systemLabels: Readonly<Record<string, string>>;
  readonly variableNames: readonly string[];
  readonly resourcePreviews: Readonly<Record<string, DocumentResourcePreview>>;
  readonly onEditorReady: (handle: DocumentEditorHandle | null) => void;
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
    <div className="relative border border-dashed border-border bg-muted/40 p-2 pt-4 text-xs text-muted-foreground">
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
      className="relative border-b border-border bg-muted px-[8%] pb-4 pt-6 text-xs text-foreground [&_td:last-child]:whitespace-nowrap"
      data-testid="document-designer-letterhead"
    >
      <span className="absolute right-[8%] top-2 text-[10px] uppercase tracking-wide text-muted-foreground">
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

export function PageCanvas(props: PageCanvasProps): ReactNode {
  const t = useTranslation();
  const { meta } = props;
  const showRegions = meta.layoutHeaderFooter && props.regions !== null;
  // The letterhead band sits in the top margin, so the content starts right below it.
  const showLetterhead =
    showRegions && props.regions !== null && props.regions.header.trim() !== "";
  // Same fallback as the PDF renderer: a footer region reserves a taller bottom margin (the header band replaces the top margin on the canvas).
  const hasFooter = showRegions && props.regions !== null && props.regions.footer.trim() !== "";
  const fromLayout = t("documentDesigner.canvas.fromLayout", { layout: props.layoutName });
  const regionCaption = (region: "header" | "signature" | "footer"): string =>
    `${t(`documentDesigner.editor.region.${region}`)} · ${fromLayout}`;

  // CSS variables instead of a style prop: margins are user data, classes are static.
  const applyMargins = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      for (const side of MARGIN_SIDES) {
        const fallbackMm =
          side === "bottom" && hasFooter ? PDF_FOOTER_MARGIN_MM : PDF_DEFAULT_MARGIN_MM;
        const mm = meta.margins[side] === "" ? fallbackMm : meta.margins[side];
        element.style.setProperty(`--page-margin-${side}`, `${Math.round(mm * MM_TO_PX)}px`);
      }
    },
    [meta.margins, hasFooter],
  );

  const renderPaper = (editable: ReactNode): ReactNode => (
    <div className="flex w-full flex-col items-center gap-2">
      <div
        data-testid="document-designer-page"
        className={cn(
          "flex min-h-[1000px] w-full flex-col bg-card shadow-md",
          PAGE_WIDTH_CLASSES[`${meta.pageFormat}-${meta.orientation}`],
        )}
      >
        {showLetterhead && props.regions !== null && (
          <HeaderBand
            html={props.regions.header}
            systemLabels={props.systemLabels}
            resourceSrc={props.resourceSrc}
            caption={fromLayout}
          />
        )}
        <div
          ref={applyMargins}
          className={cn(
            "flex min-h-0 flex-1 flex-col pr-(--page-margin-right) pb-(--page-margin-bottom) pl-(--page-margin-left)",
            !showLetterhead && "pt-(--page-margin-top)",
          )}
        >
          <div
            className="relative my-2 min-h-0 flex-1 border border-dashed border-primary/40 p-2 pt-5"
            data-testid="document-designer-content-area"
          >
            <span className="absolute left-2 top-0.5 text-[10px] uppercase tracking-wide text-primary">
              {t("documentDesigner.editor.region.content")}
            </span>
            {editable}
          </div>
          {showRegions && props.regions !== null && (
            <>
              <RegionBlock
                html={props.regions.signature}
                systemLabels={props.systemLabels}
                resourceSrc={props.resourceSrc}
                caption={regionCaption("signature")}
              />
              <RegionBlock
                html={props.regions.footer}
                systemLabels={props.systemLabels}
                resourceSrc={props.resourceSrc}
                caption={regionCaption("footer")}
              />
            </>
          )}
        </div>
      </div>
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
        readOnly={false}
        blocks={PDF_DOCUMENT_BLOCKS}
        variableLabels={props.variableLabels}
        systemVariables={props.systemVariables}
        resourcePreviews={props.resourcePreviews}
        chrome="canvas"
        renderPaper={renderPaper}
        onEditorReady={props.onEditorReady}
      />
    </div>
  );
}
