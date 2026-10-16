// @runtime client
import {
  DocumentContentEditor,
  type DocumentEditorHandle,
  type DocumentResourcePreview,
  PDF_DOCUMENT_BLOCKS,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { cn } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useCallback } from "react";
import { LayoutHtml } from "./layout-html.js";
import { MARGIN_SIDES, type PdfMetaDraft } from "./pdf-meta.js";
import type { LayoutRegionsHtml } from "./types.js";

const MM_TO_PX = 96 / 25.4;
const DEFAULT_MARGIN_MM = 15;

// Page width in CSS px at 96 dpi, as a class so no inline width is needed.
const PAGE_WIDTH_CLASSES: Readonly<Record<string, string>> = {
  "A4-portrait": "w-[794px]",
  "A4-landscape": "w-[1123px]",
  "Letter-portrait": "w-[816px]",
  "Letter-landscape": "w-[1056px]",
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
  readonly onEditorReady: (handle: DocumentEditorHandle) => void;
};

function RegionBlock({
  html,
  systemLabels,
  caption,
}: {
  html: string;
  systemLabels: Readonly<Record<string, string>>;
  caption: string;
}): ReactNode {
  if (html.trim() === "") return null;
  return (
    <div className="relative border border-dashed border-border bg-muted/40 p-2 text-xs text-muted-foreground">
      <span className="absolute right-1 top-0 text-[10px] uppercase tracking-wide">{caption}</span>
      <LayoutHtml html={html} systemLabels={systemLabels} />
    </div>
  );
}

export function PageCanvas(props: PageCanvasProps): ReactNode {
  const t = useTranslation();
  const { meta } = props;
  const showRegions = meta.layoutHeaderFooter && props.regions !== null;
  const caption = t("documentDesigner.canvas.fromLayout", { layout: props.layoutName });

  // CSS variables instead of a style prop: margins are user data, classes are static.
  const applyMargins = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      for (const side of MARGIN_SIDES) {
        const mm = meta.margins[side] === "" ? DEFAULT_MARGIN_MM : meta.margins[side];
        element.style.setProperty(`--page-margin-${side}`, `${Math.round(mm * MM_TO_PX)}px`);
      }
    },
    [meta.margins],
  );

  return (
    <div className="flex flex-col items-center gap-2 overflow-auto bg-muted p-6">
      <div
        ref={applyMargins}
        data-testid="document-designer-page"
        className={cn(
          "flex min-h-[1000px] max-w-none flex-col bg-background shadow-md",
          "pt-(--page-margin-top) pr-(--page-margin-right) pb-(--page-margin-bottom) pl-(--page-margin-left)",
          PAGE_WIDTH_CLASSES[`${meta.pageFormat}-${meta.orientation}`],
        )}
      >
        {showRegions && props.regions !== null && (
          <RegionBlock
            html={props.regions.header}
            systemLabels={props.systemLabels}
            caption={caption}
          />
        )}
        <div className="min-h-0 flex-1 py-2">
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
            onEditorReady={props.onEditorReady}
          />
        </div>
        {showRegions && props.regions !== null && (
          <>
            <RegionBlock
              html={props.regions.signature}
              systemLabels={props.systemLabels}
              caption={caption}
            />
            <RegionBlock
              html={props.regions.footer}
              systemLabels={props.systemLabels}
              caption={caption}
            />
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("documentDesigner.canvas.caption", { format: meta.pageFormat })}
      </p>
    </div>
  );
}
