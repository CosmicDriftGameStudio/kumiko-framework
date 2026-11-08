import { ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useOptionalLocale, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import "../react-css-custom-properties.ts";

export const TABLE_FOOTER_BAR_CLASS = cn(
  "flex h-15 shrink-0 items-center gap-4 border-t border-border-row bg-card pl-4 pr-2",
  "text-[12.5px] tabular-nums text-muted-foreground md:h-11 md:px-6",
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

// Pager — left "X – Y of Z", right the page size select in text style and "‹ Page 1 of 3 ›" from sm; below sm
// only the arrows.
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
  testId,
  pinned,
  plain,
}: {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly onPageChange: (next: number) => void;
  readonly pageSizeOptions?: readonly number[];
  readonly onPageSizeChange?: (next: number) => void;
  readonly testId?: string;
  readonly pinned?: boolean;
  /** Phone cards: no bar, border or background; the footer sits on the page like the card list. */
  readonly plain?: boolean;
}): ReactNode {
  const t = useTranslation();
  const locale = useOptionalLocale();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const from = total === 0 ? 0 : (safePage - 1) * limit + 1;
  const to = Math.min(safePage * limit, total);

  return (
    <div
      data-testid={testId}
      className={
        plain === true
          ? "flex items-center justify-between px-4 pb-3 pt-1 text-[12.5px] tabular-nums text-muted-foreground"
          : pinned === true
            ? TABLE_FOOTER_BAR_CLASS
            : "mt-3 flex items-center gap-4 text-[12.5px] tabular-nums text-muted-foreground"
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <div data-testid={testId !== undefined ? `${testId}-status` : undefined}>
          {total === 0
            ? t("kumiko.pager.statusEmpty")
            : t("kumiko.pager.status", {
                from: from.toLocaleString(locale),
                to: to.toLocaleString(locale),
                total: total.toLocaleString(locale),
              })}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {pageSizeOptions !== undefined && onPageSizeChange !== undefined && (
          <div className="relative mr-2 hidden items-center sm:flex">
            <select
              aria-label={t("kumiko.pager.pageSizeLabel")}
              data-testid={testId !== undefined ? `${testId}-page-size` : undefined}
              value={limit}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 cursor-pointer appearance-none rounded-md border border-border-strong bg-card py-0 pl-2.5 pr-7 text-[12.5px] text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {t("kumiko.pager.pageSize", { size: size.toLocaleString(locale) })}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        )}
        <PagerButton
          ariaLabel={t("kumiko.pager.previousPage")}
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          testId={testId !== undefined ? `${testId}-prev` : undefined}
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
        </PagerButton>
        <span
          data-testid={testId !== undefined ? `${testId}-page-label` : undefined}
          className="hidden px-1 sm:inline"
        >
          {t("kumiko.pager.pageOf", {
            page: safePage.toLocaleString(locale),
            total: totalPages.toLocaleString(locale),
          })}
        </span>
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
        "inline-flex size-8 items-center justify-center rounded-md border border-border-strong bg-card",
        "hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:text-foreground-disabled",
      )}
    >
      {children}
    </button>
  );
}
