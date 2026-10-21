import type { ReactNode } from "react";
import type { CardProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { InsideScreenFormColumnContext } from "./metric.tsx";
import "../react-css-custom-properties.ts";
import { cardFooter, cardFooterBorder, cardFooterInset, cardSurface } from "./card-styles.ts";
import { FormScreenShell } from "./form.tsx";

// Generic card chrome (rounded-xl like the entity card), slot- and
// options-based so the contract grows additively and consumers never have
// to migrate.
export function DefaultCard({
  slots,
  options,
  className,
  testId,
  dataAttributes,
  children,
}: CardProps): ReactNode {
  const screenBody = options?.screenBody ?? false;
  const padded = screenBody ? false : (options?.padded ?? true);
  const radius = options?.radius ?? "xl";
  const footerBordered = options?.footerBordered ?? true;
  const footerInset = options?.footerInset ?? true;
  const fillHeight = options?.fillHeight ?? false;
  const framed = screenBody ? false : (options?.framed ?? true);
  const s = slots ?? {};
  const defaultHeader =
    s.title !== undefined ||
    s.subtitle !== undefined ||
    s.headerContent !== undefined ||
    s.headerActions !== undefined ? (
      <div
        className={cn(
          "flex flex-col gap-3 px-[var(--card-padding)] pt-6 pb-4",
          fillHeight && "shrink-0",
        )}
      >
        {(s.title !== undefined || s.subtitle !== undefined || s.headerActions !== undefined) && (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              {s.title !== undefined && (
                <h3 className="text-base font-semibold leading-none tracking-tight">{s.title}</h3>
              )}
              {s.subtitle !== undefined && (
                <p className="text-sm text-muted-foreground">{s.subtitle}</p>
              )}
            </div>
            {s.headerActions}
          </div>
        )}
        {/* Own full-width row: beside the actions, block content would end at
            a different right edge than the card body below it. */}
        {s.headerContent}
      </div>
    ) : null;
  const header = s.header ?? defaultHeader;
  const hasHeader = header !== null && header !== undefined;
  const card = (
    <div
      {...dataAttributes}
      data-slot="card"
      data-testid={testId}
      className={cn(
        framed ? cardSurface({ radius }) : "flex flex-col",
        // An unframed card has no radius to clip; overflow-hidden would also
        // zero its flex-item min-height and cut off content inside a scroller.
        (framed || fillHeight) && "overflow-hidden",
        // Same "no flex-1" reasoning as DefaultForm's own fillHeight card
        // (fw#2722/#2778): sizes to content and only shrinks (min-h-0) once
        // an ancestor is itself height-constrained.
        fillHeight && "min-h-0 flex flex-col",
        className,
      )}
    >
      {header}
      {/* != null covers undefined AND explicit null; a `false` child (from
          `cond && <El/>`) still renders no visible content either way. */}
      {children != null && (
        <div
          className={cn(
            "grow",
            screenBody && "flex flex-col gap-6",
            padded &&
              (hasHeader
                ? "px-[var(--card-padding)] pb-[var(--card-padding)]"
                : "p-[var(--card-padding)]"),
            // The one region allowed to shrink and scroll internally — mirrors
            // FormSections' fillHeight === true && "min-h-0" treatment of the
            // section it wraps.
            fillHeight && "min-h-0 flex flex-col",
          )}
        >
          {children}
        </div>
      )}
      {s.footer !== undefined && s.footer !== null && s.footer !== false && (
        <div
          className={cn(
            cardFooter,
            footerInset && cardFooterInset,
            footerBordered && cardFooterBorder,
            fillHeight && "shrink-0",
          )}
        >
          {s.footer}
        </div>
      )}
    </div>
  );
  return (
    <InsideScreenFormColumnContext.Provider value={false}>
      {screenBody ? <FormScreenShell>{card}</FormScreenShell> : card}
    </InsideScreenFormColumnContext.Provider>
  );
}
