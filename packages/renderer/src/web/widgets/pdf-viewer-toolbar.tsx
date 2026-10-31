import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { usePrimitives, useTranslation } from "../../index.ts";

export type PdfSearchState = {
  readonly open: boolean;
  readonly term: string;
  readonly matchCount: number;
  /** 0-based index of the active match. */
  readonly matchIndex: number;
};

export type PdfViewerToolbarProps = {
  readonly currentPage: number;
  readonly pageCount: number;
  readonly onGoToPage: (page: number) => void;
  readonly zoom: number;
  readonly onZoomOut: () => void;
  readonly onZoomIn: () => void;
  readonly search: PdfSearchState;
  readonly onToggleSearch: () => void;
  readonly onTermChange: (term: string) => void;
  readonly onStepMatch: (direction: 1 | -1) => void;
  readonly hideSearch?: boolean;
};

const INPUT_CLASS =
  "h-[26px] rounded border border-input bg-transparent px-1.5 text-center text-sm text-foreground";

// Bordered like the page input beside them, so the toolbar reads as controls of the document.
const TOOL_BUTTON_CLASS = "size-7";

function PageNumberInput({
  currentPage,
  onGoToPage,
}: Pick<PdfViewerToolbarProps, "currentPage" | "onGoToPage">): ReactNode {
  const t = useTranslation();
  const [draft, setDraft] = useState(String(currentPage));
  useEffect(() => setDraft(String(currentPage)), [currentPage]);
  return (
    <label className="flex items-center gap-1.5">
      {t("kumiko.widget.pdf-preview.page")}
      <input
        type="text"
        inputMode="numeric"
        aria-label={t("kumiko.widget.pdf-preview.pageInput")}
        className={`${INPUT_CLASS} w-9`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setDraft(String(currentPage))}
        onKeyDown={(event) => {
          if (event.key === "Enter") onGoToPage(Number.parseInt(draft, 10));
        }}
      />
    </label>
  );
}

function SearchControls({
  search,
  onTermChange,
  onStepMatch,
}: Pick<PdfViewerToolbarProps, "search" | "onTermChange" | "onStepMatch">): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  const hasTerm = search.term.trim() !== "";
  return (
    <>
      <input
        type="search"
        aria-label={t("kumiko.widget.pdf-preview.search")}
        className={`${INPUT_CLASS} w-40 text-left`}
        value={search.term}
        onChange={(event) => onTermChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onStepMatch(event.shiftKey ? -1 : 1);
        }}
      />
      {hasTerm && (
        <span className="whitespace-nowrap text-muted-foreground" data-testid="pdf-match-count">
          {search.matchCount === 0
            ? t("kumiko.widget.pdf-preview.noMatch")
            : t("kumiko.widget.pdf-preview.matchCount", {
                index: search.matchIndex + 1,
                total: search.matchCount,
              })}
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        ariaLabel={t("kumiko.widget.pdf-preview.previousMatch")}
        disabled={search.matchCount === 0}
        onClick={() => onStepMatch(-1)}
      >
        <ChevronUp aria-hidden="true" className="size-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        ariaLabel={t("kumiko.widget.pdf-preview.nextMatch")}
        disabled={search.matchCount === 0}
        onClick={() => onStepMatch(1)}
      >
        <ChevronDown aria-hidden="true" className="size-4" />
      </Button>
    </>
  );
}

export function PdfViewerToolbar(props: PdfViewerToolbarProps): ReactNode {
  const t = useTranslation();
  const { Button } = usePrimitives();
  return (
    <div
      data-testid="pdf-toolbar"
      className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-card px-2.5 text-[13px]"
    >
      <PageNumberInput currentPage={props.currentPage} onGoToPage={props.onGoToPage} />
      <span className="text-muted-foreground">
        {t("kumiko.widget.pdf-preview.pageCount", { pages: props.pageCount })}
      </span>
      <span className="grow" />
      {props.search.open && props.hideSearch !== true && (
        <SearchControls
          search={props.search}
          onTermChange={props.onTermChange}
          onStepMatch={props.onStepMatch}
        />
      )}
      <Button
        size="icon"
        variant="secondary"
        className={TOOL_BUTTON_CLASS}
        ariaLabel={t("kumiko.widget.pdf-preview.zoomOut")}
        onClick={props.onZoomOut}
      >
        −
      </Button>
      <span
        className="min-w-11 whitespace-nowrap text-center text-muted-foreground"
        data-testid="pdf-zoom"
      >
        {Math.round(props.zoom * 100)} %
      </span>
      <Button
        size="icon"
        variant="secondary"
        className={TOOL_BUTTON_CLASS}
        ariaLabel={t("kumiko.widget.pdf-preview.zoomIn")}
        onClick={props.onZoomIn}
      >
        +
      </Button>
      {props.hideSearch !== true && (
        <Button
          size="icon"
          variant="secondary"
          className={TOOL_BUTTON_CLASS}
          pressed={props.search.open}
          ariaLabel={t("kumiko.widget.pdf-preview.search")}
          onClick={props.onToggleSearch}
        >
          <Search aria-hidden="true" className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
