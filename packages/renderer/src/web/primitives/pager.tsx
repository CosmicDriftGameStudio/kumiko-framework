import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import "../react-css-custom-properties.ts";

export const TABLE_FOOTER_BAR_CLASS = cn(
  "flex h-15 shrink-0 items-center gap-4 border-t border-border bg-card pl-4 pr-2",
  "text-[13px] tabular-nums text-foreground-secondary md:h-11 md:px-6",
);

// InfiniteSentinel — empty div at the end of the table that uses
// IntersectionObserver to detect when the user scrolls near the list end.
// onReachEnd fires exactly once per "becomes visible" transition; the
// caller debounces via loadingMore (further visibility events are ignored
// while a page is loading). No observer during server-side render, no
// observer when hasMore=false — then the sentinel only shows the
// end-of-list hint via t("kumiko.list.end-of-list"), which requires a
// LocaleProvider in the tree (same requirement as Field/useRowActionTrigger).
// Without one, useTranslation() throws; with one that's missing the framework
// defaults (fallbackBundles not including kumikoDefaultTranslations), the
// user sees the raw key instead of translated text.
// ponytail: threshold mirrors the framework default pageSize (kumiko-screen.tsx
// `screen.pageSize ?? 50`) rather than the real per-screen pageSize, which isn't
// threaded down to this component. A screen with a custom pageSize can still
// under- or over-show the marker; thread pageSize through KumikoScreen →
// RenderList → DataTable → InfiniteSentinel if that's needed.
export const END_LABEL_MIN_ROWS = 50;

export function InfiniteSentinel({
  onReachEnd,
  loadingMore,
  hasMore,
  rowsCount,
  testId,
}: {
  readonly onReachEnd: () => void;
  readonly loadingMore: boolean;
  readonly hasMore: boolean;
  readonly rowsCount: number;
  readonly testId?: string;
}): ReactNode {
  const t = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore) return;
    if (loadingMore) return;
    if (typeof IntersectionObserver === "undefined") return;
    const node = ref.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Only fire the first visible event per mount: if the user keeps
        // scrolling while loading is still in progress, loadingMore=true keeps the
        // useEffect from remounting the observer at all.
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onReachEnd();
            break;
          }
        }
      },
      { rootMargin: "200px" }, // pre-fetch when the sentinel is 200px from the viewport
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onReachEnd, loadingMore, hasMore]);

  const showEndLabel = !hasMore && rowsCount >= END_LABEL_MIN_ROWS;

  return (
    <div
      ref={ref}
      data-testid={testId}
      className={cn(
        "flex items-center justify-center text-sm text-muted-foreground",
        showEndLabel || loadingMore ? "py-4" : "",
      )}
    >
      {showEndLabel ? (
        <span data-testid={testId !== undefined ? `${testId}-end` : undefined}>
          {t("kumiko.list.end-of-list")}
        </span>
      ) : loadingMore ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : hasMore ? (
        // Invisible spacer as long as more can be loaded: the observer needs a
        // DOM node, but the user should see nothing.
        <span aria-hidden="true">&nbsp;</span>
      ) : null}
    </div>
  );
}

// Pager — status text on the left ("X – Y of Z"), "Page X of Y" and the
// prev/next arrows on the right. No numbered page list: the board shows none.
// `pinned` renders the footer bar of a scrollBody table (fixed height, top
// border); unpinned it sits as a plain row below the table.
//
// Status text and aria-labels go through t(...), which requires a
// LocaleProvider in the tree — same requirement as InfiniteSentinel above,
// already established for DataTable consumers.
export function Pager({
  page,
  limit,
  total,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  itemNoun,
  testId,
  pinned,
}: {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly onPageChange: (next: number) => void;
  readonly pageSizeOptions?: readonly number[];
  readonly onPageSizeChange?: (next: number) => void;
  readonly itemNoun?: (count: number) => string;
  readonly testId?: string;
  readonly pinned?: boolean;
}): ReactNode {
  const t = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const from = (safePage - 1) * limit + 1;
  const to = Math.min(safePage * limit, total);

  return (
    <div
      data-testid={testId}
      className={
        pinned === true
          ? TABLE_FOOTER_BAR_CLASS
          : "mt-3 flex items-center gap-4 text-[13px] tabular-nums text-foreground-secondary"
      }
    >
      <div data-testid={testId !== undefined ? `${testId}-status` : undefined} className="flex-1">
        {itemNoun !== undefined
          ? t("kumiko.pager.status.noun", {
              from: from.toLocaleString(),
              to: to.toLocaleString(),
              total: total.toLocaleString(),
              noun: itemNoun(total),
            })
          : t("kumiko.pager.status", {
              from: from.toLocaleString(),
              to: to.toLocaleString(),
              total: total.toLocaleString(),
            })}
      </div>
      {pageSizeOptions !== undefined && onPageSizeChange !== undefined && (
        <div className="relative hidden md:block">
          <select
            aria-label={t("kumiko.pager.pageSizeLabel")}
            data-testid={testId !== undefined ? `${testId}-page-size` : undefined}
            value={limit}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-7 appearance-none rounded-md border border-input bg-card pl-2 pr-7 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {t("kumiko.pager.pageSize", { size: size.toLocaleString() })}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 opacity-50"
            aria-hidden="true"
          />
        </div>
      )}
      <div className="hidden md:block">
        {t("kumiko.pager.pageOf", {
          page: safePage.toLocaleString(),
          pages: totalPages.toLocaleString(),
        })}
      </div>
      <div className="flex items-center gap-2">
        <PagerButton
          ariaLabel={t("kumiko.pager.previousPage")}
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          testId={testId !== undefined ? `${testId}-prev` : undefined}
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        </PagerButton>
        <PagerButton
          ariaLabel={t("kumiko.pager.nextPage")}
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          testId={testId !== undefined ? `${testId}-next` : undefined}
        >
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </PagerButton>
      </div>
    </div>
  );
}

function PagerButton({
  children,
  onClick,
  ariaLabel,
  disabled,
  testId,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly testId?: string;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        "inline-flex size-11 items-center justify-center rounded-md border border-border md:size-7",
        "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:text-foreground-disabled",
      )}
    >
      {children}
    </button>
  );
}
