import type { ReactNode } from "react";
import type { CardProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { InsideScreenFormColumnContext } from "./metric.tsx";
import "../react-css-custom-properties.ts";
import { cardFooter, cardFooterBorder, cardFooterInset, cardSurface } from "./card-styles.ts";
import { FormScreenShell } from "./form.tsx";

function cardBodyPadding(inline: boolean, hasHeader: boolean): string {
  if (inline) return "px-4 pb-4 pt-3";
  return hasHeader
    ? "px-[var(--card-padding)] pb-[var(--card-padding)]"
    : "p-[var(--card-padding)]";
}

function CardTitleRow({
  slots,
  inline,
  labelTitle,
}: {
  readonly slots: NonNullable<CardProps["slots"]>;
  readonly inline: boolean;
  readonly labelTitle: boolean;
}): ReactNode {
  const { title, subtitle, headerActions } = slots;
  if (inline) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        {title !== undefined && <h3 className="m-0 text-sm font-semibold">{title}</h3>}
        {subtitle !== undefined && (
          <div className="text-[12.5px] text-muted-foreground">{subtitle}</div>
        )}
        {headerActions !== undefined && <div className="ml-auto">{headerActions}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        {title !== undefined && (
          <h3
            className={
              labelTitle
                ? "text-[12.5px] font-semibold uppercase leading-none tracking-[0.06em] text-muted-foreground"
                : "text-base font-semibold leading-none tracking-tight"
            }
          >
            {title}
          </h3>
        )}
        {subtitle !== undefined && <div className="text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {headerActions}
    </div>
  );
}

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
  const inlineHeader = options?.headerLayout === "inline";
  const hasTitleRow =
    s.title !== undefined || s.subtitle !== undefined || s.headerActions !== undefined;
  const defaultHeader =
    hasTitleRow || s.headerContent !== undefined ? (
      <div
        className={cn(
          "flex flex-col gap-3",
          inlineHeader ? "px-4 pt-3.5" : "px-[var(--card-padding)] pt-6 pb-4",
          fillHeight && "shrink-0",
        )}
      >
        {hasTitleRow && (
          <CardTitleRow
            slots={s}
            inline={inlineHeader}
            labelTitle={options?.titleStyle === "label"}
          />
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
        // Same "no flex-1" reasoning as DefaultForm's own fillHeight card:
        // sizes to content and only shrinks (min-h-0) once
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
            padded && cardBodyPadding(inlineHeader, hasHeader),
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
