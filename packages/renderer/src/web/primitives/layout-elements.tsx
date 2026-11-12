import { Children, type CSSProperties, type MouseEvent, type ReactNode, useContext } from "react";
import { isSafeHref } from "../../headless/index.ts";
import type {
  FieldCellWidth,
  FillContainerProps,
  GridCellProps,
  GridProps,
  HeadingProps,
  LinkProps,
  ProgressProps,
  SectionProps,
  StepBarProps,
  TextProps,
  WizardStepGroupProps,
} from "../../index.ts";
import { Icon } from "../icons.tsx";
import { cn } from "../lib/cn.ts";
import { buttonVariants } from "../ui/button.tsx";
import { ProgressBar } from "../widgets/progress-bar.tsx";
import { StepBar } from "../widgets/step-bar.tsx";
import "../react-css-custom-properties.ts";
import { cardSurface } from "./card-styles.ts";
import { DrawerBodyContext, InsideFormContext, ScreenFormContext } from "./contexts.tsx";

// Desktop boards print the hint under the data, phone boards above it.
const SECTION_HINT_CLASS =
  "m-0 mt-3 text-[12.5px] text-muted-foreground max-sm:order-first max-sm:mb-3 max-sm:mt-0";

function SectionHint({ text, textNarrow, testId }: NonNullable<SectionProps["hint"]>): ReactNode {
  if (textNarrow !== undefined) {
    return (
      <p data-testid={testId} className={SECTION_HINT_CLASS}>
        <NarrowText text={text} narrow={textNarrow} />
      </p>
    );
  }
  const end = text.indexOf(". ");
  const first = end === -1 ? text : text.slice(0, end + 1);
  const rest = end === -1 ? "" : text.slice(end + 1);
  return (
    <p data-testid={testId} className={SECTION_HINT_CLASS}>
      <strong className="font-semibold">{first}</strong>
      {rest}
    </p>
  );
}

// The flex column lets the phone hint jump above the content via `order-first`.
function withSectionHint(children: ReactNode, hint: SectionProps["hint"]): ReactNode {
  if (hint === undefined) return children;
  return (
    <div className="flex flex-col">
      {children}
      <SectionHint {...hint} />
    </div>
  );
}

function NarrowText({ text, narrow }: { text: ReactNode; narrow: string }): ReactNode {
  return (
    <>
      <span className="max-sm:hidden">{text}</span>
      <span className="sm:hidden">{narrow}</span>
    </>
  );
}

export function DefaultSection({
  id,
  title,
  subtitle,
  subtitleBelowLgOnly,
  children,
  actions,
  variant = "default",
  layout = "stacked",
  titleStyle = "heading",
  hint,
  testId,
  icon,
}: SectionProps): ReactNode {
  const labelTitle = titleStyle === "label";
  const insideForm = useContext(InsideFormContext);
  const insideScreenForm = useContext(ScreenFormContext);

  // h3 instead of CardTitle (= div): keeps the heading semantics for
  // screen reader navigation. The subtitle flows below (no divider,
  // shadcn CardTitle+CardDescription pattern).
  // icon only renders alongside a title — a title-less section has nothing
  // for a lone icon to sit next to, so it stays as-is (no heading grows).
  // actions render top-right in this same title row, never a
  // footer — a title-less section still draws the row when actions are
  // present, so a hideTitle tabs-Section with `actions` isn't stranded.
  const TitleTag = insideScreenForm ? "h2" : "h3";
  const titleBlock =
    title !== undefined || subtitle !== undefined ? (
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        {title !== undefined && (
          <TitleTag
            data-section-title=""
            data-testid={testId !== undefined ? `${testId}-title` : undefined}
            className={cn(
              "flex items-center gap-2",
              labelTitle
                ? "text-[12.5px] font-semibold uppercase leading-none tracking-[0.06em] text-muted-foreground"
                : "text-base font-semibold leading-none tracking-tight",
            )}
          >
            {icon !== undefined && <Icon name={icon} className="size-4 text-muted-foreground" />}
            {title}
          </TitleTag>
        )}
        {subtitle !== undefined && (
          <div
            data-testid={testId !== undefined ? `${testId}-subtitle` : undefined}
            className={cn(
              "text-sm text-muted-foreground",
              insideScreenForm && "text-[13px] text-foreground-secondary",
              subtitleBelowLgOnly === true && "lg:hidden",
            )}
          >
            {subtitle}
          </div>
        )}
      </div>
    ) : null;
  const header =
    titleBlock !== null || actions !== undefined ? (
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        {titleBlock}
        {actions !== undefined && (
          <div
            data-testid={testId !== undefined ? `${testId}-actions` : undefined}
            className="ml-auto flex shrink-0 items-center gap-2"
          >
            {actions}
          </div>
        )}
      </div>
    ) : null;

  // Inside a form: divider-less section WITHOUT a card surface of its own.
  // The separator lines BETWEEN sections come from the divide-y wrapper in
  // the form.
  if (insideForm) {
    return (
      <section
        id={id}
        data-testid={testId}
        className={cn(
          // py-4 (not the standalone card's py-6): the border-t between
          // sections already carries the section break, so the vertical
          // gap only needs to read as roughly double the gap-4 field row
          // spacing, not triple it.
          insideScreenForm
            ? labelTitle
              ? "flex scroll-mt-4 flex-col gap-2 [&:not(:first-of-type)]:pt-6"
              : "flex scroll-mt-4 flex-col gap-4 [&:not(:first-of-type)]:border-t [&:not(:first-of-type)]:border-border [&:not(:first-of-type)]:pt-7"
            : "flex flex-col gap-4 px-6 py-4",
          variant === "destructive" && "border-l-2 border-destructive/40",
          layout === "settings-list" && "@container max-w-[944px]",
        )}
      >
        {header}
        {withSectionHint(children, hint)}
      </section>
    );
  }

  // Standalone: own card, header flows into the body (no divider).
  // overflow-hidden clips the card's own corner radius correctly for
  // portaled overlays (Combobox/Select/Tooltip escape to document.body,
  // unaffected). A non-portaled overlay (e.g. a custom dropdown built
  // directly into `children`) WOULD get silently clipped — verify this
  // against any new standalone-section content that renders its own
  // non-portaled overlay.
  return (
    <div
      data-slot="card"
      data-testid={testId}
      className={cn(
        cardSurface(),
        "overflow-hidden",
        variant === "destructive" && "border-destructive/40",
      )}
    >
      <div className="flex flex-col gap-4 px-6 py-6">
        {header}
        {withSectionHint(children, hint)}
      </div>
    </div>
  );
}

export function DefaultFillContainer({
  children,
  testId,
  grow,
  className,
}: FillContainerProps): ReactNode {
  // flex-1 only on request (`grow`, set under fillScreenHeight): without it the
  // container sizes to its content and only shrinks (min-h-0), so a two-row
  // table in a non-fixed-height screen does not stretch.
  return (
    <div
      data-testid={testId}
      className={cn("flex min-h-0 flex-col", grow === true && "flex-1", className)}
    >
      {children}
    </div>
  );
}

const DRAWER_FIELD_CELL_WIDTH_CLASS: Partial<Record<FieldCellWidth, string>> = {
  money: "w-full [&_label]:whitespace-nowrap",
  select: "w-full",
};

const FIELD_CELL_WIDTH_CLASS: Readonly<Record<FieldCellWidth, string>> = {
  text: "w-full sm:w-60",
  number: "w-fit min-w-24 shrink-0 [&_label]:whitespace-nowrap [&_[data-slot=number-field]]:w-32",
  money: "w-40 shrink-0 [&_label]:whitespace-nowrap",
  date: "w-full sm:w-[200px]",
  timestamp: "w-full sm:w-[328px]",
  select: "w-full sm:w-60 sm:has-[[data-radio-list]]:w-full",
  full: "w-full",
  // self-start: the label shares the top line with neighbouring labels. The
  // switch (1.15rem) gets (h-9 input − switch) / 2 margin to sit on the input line.
  toggle: "w-auto min-w-40 shrink-0 self-start [&_[data-slot=switch]]:my-[0.55rem]",
};

export function DefaultGrid({
  columns,
  children,
  testId,
  maxRows,
  flow,
  list,
  ariaLabelledBy,
  tight,
  facts,
  legend,
}: GridProps): ReactNode {
  const insideDrawerBody = useContext(DrawerBodyContext);
  const groupProps =
    ariaLabelledBy !== undefined
      ? { role: "group" as const, "aria-labelledby": ariaLabelledBy }
      : {};
  if (list === true) {
    return (
      <div {...groupProps} data-testid={testId} className="flex flex-col divide-y divide-border">
        {children}
      </div>
    );
  }
  if (legend === true) {
    return (
      <div
        {...groupProps}
        data-testid={testId}
        data-legend=""
        className="grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-4 gap-y-3 [&>:nth-child(odd)]:whitespace-nowrap"
      >
        {children}
      </div>
    );
  }
  if (facts === true && typeof columns === "number") {
    const factStyle: CSSProperties = {
      "--grid-cols": `repeat(${columns}, minmax(0, 1fr))`,
      "--grid-cols-narrow": `repeat(${Math.min(columns, 2)}, minmax(0, 1fr))`,
    };
    return (
      <div
        {...groupProps}
        data-testid={testId}
        data-facts=""
        className="grid gap-x-6 gap-y-3 [grid-template-columns:var(--grid-cols-narrow)] sm:[grid-template-columns:var(--grid-cols)] [&_label]:text-[12.5px] [&_label]:font-normal [&_label]:text-muted-foreground [&_[data-testid^=field-value-]]:text-sm [&_[data-testid^=field-value-]:not([data-concealed])]:font-medium [&_[data-testid^=field-value-]:not([data-concealed])]:text-foreground"
        style={factStyle}
      >
        {children}
      </div>
    );
  }
  if (flow === true) {
    return (
      <div
        {...groupProps}
        data-testid={testId}
        className={cn(
          "flex gap-4",
          insideDrawerBody
            ? "flex-col items-start"
            : // items-end aligns inputs when labels wrap to different heights; a
              // below-control appendix grows only the one cell and would push its
              // neighbours down, so such rows align to the top instead. An error
              // line does the same: bottom-aligned, it would lift that field's
              // label above its neighbours'.
              "flex-wrap items-end has-[[data-appendix-below]]:items-start has-[[role=alert]]:items-start",
        )}
      >
        {children}
      </div>
    );
  }
  // "auto": content-sized items in a wrapping row (e.g. a metrics band of
  // self-sized tiles) instead of N equal-width, container-stretched tracks.
  // maxRows/scrolling don't apply — the row just wraps.
  if (columns === "auto") {
    return (
      <div
        {...groupProps}
        data-testid={testId}
        className={cn("flex flex-wrap items-center", tight === true ? "gap-2" : "gap-4")}
      >
        {children}
      </div>
    );
  }
  // Responsive: mobile (< sm = 640px) stays single-column, from sm on the
  // author-declared column count applies. The inline style writes a CSS
  // variable; the Tailwind class reads it with
  // `grid-template-columns: var(--grid-cols)`. A clean solution because
  // Tailwind JIT cannot resolve a dynamic `grid-cols-${N}`.
  const rowCount = Math.ceil(Children.toArray(children).length / columns);
  const clipped = maxRows !== undefined && rowCount > maxRows;
  // gridAutoRows is a minmax MIN, not a fixed height, so wrapped labels grow
  // their row instead of being clipped mid-row. maxHeight is therefore only
  // an approximation of "maxRows rows tall" — a row taller than the minimum
  // means fewer than maxRows rows end up visible before scrolling kicks in.
  // Themes may override --kumiko-grid-row-h (default 2.5rem, set in
  // styles.css) to change that minimum.
  // Mobile note: the grid collapses to 1 column below `sm` (see className),
  // but rowCount above is always computed against the desktop `columns` —
  // inline styles can't express a media query, so the mobile row count is
  // an under-count. Known, accepted.
  const style: CSSProperties = {
    "--grid-cols": `repeat(${columns}, minmax(0, 1fr))`,
    ...(clipped && {
      gridAutoRows: "minmax(var(--kumiko-grid-row-h, 2.5rem), auto)",
      maxHeight: `calc(${maxRows} * var(--kumiko-grid-row-h, 2.5rem) + ${maxRows - 1} * var(--kumiko-grid-gap, 1rem))`,
      overflowY: "auto",
    }),
  };
  return (
    <div
      {...groupProps}
      data-testid={testId}
      className="grid gap-[var(--kumiko-grid-gap,1rem)] grid-cols-1 sm:[grid-template-columns:var(--grid-cols)]"
      style={style}
    >
      {children}
    </div>
  );
}

export function DefaultGridCell({ span, width, hideOnNarrow, children }: GridCellProps): ReactNode {
  const insideDrawerBody = useContext(DrawerBodyContext);
  if (width !== undefined) {
    return (
      <div
        className={cn(
          "min-w-0 max-w-full",
          hideOnNarrow === true && "max-sm:hidden",
          width === "full" && "sm:[grid-column:1/-1]",
          insideDrawerBody
            ? (DRAWER_FIELD_CELL_WIDTH_CLASS[width] ?? FIELD_CELL_WIDTH_CLASS[width])
            : FIELD_CELL_WIDTH_CLASS[width],
        )}
      >
        {children}
      </div>
    );
  }
  const s = span !== undefined ? Math.min(span, 12) : 1;
  // Below `sm` the grid has one explicit column (see DefaultGrid); an unconditional
  // `span N` there would add implicit auto columns that squeeze the fr column.
  const style: CSSProperties = { "--grid-span": s };
  return (
    <div
      className={cn(
        "min-w-0 sm:[grid-column:span_var(--grid-span)]",
        hideOnNarrow === true && "max-sm:hidden",
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export function DefaultText({
  variant = "body",
  decorative,
  concealed,
  narrow,
  children,
  testId,
}: TextProps): ReactNode {
  if (narrow !== undefined) return <NarrowText text={children} narrow={narrow} />;
  if (concealed === true) {
    return (
      <span
        data-testid={testId}
        data-concealed=""
        className="inline-flex items-center gap-1.5 text-muted-foreground"
      >
        <Icon name="lock" className="size-3.5 shrink-0" />
        {children}
      </span>
    );
  }
  switch (variant) {
    case "code":
      return (
        <code
          data-testid={testId}
          className="relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm"
        >
          {children}
        </code>
      );
    case "small":
      return (
        <small data-testid={testId} className="text-xs text-muted-foreground">
          {children}
        </small>
      );
    case "required-mark":
      return (
        <span data-testid={testId} data-required className="text-destructive">
          {children}
        </span>
      );
    case "muted":
      return (
        <span
          data-testid={testId}
          {...(decorative === true && { "aria-hidden": true })}
          className="text-sm text-muted-foreground"
        >
          {children}
        </span>
      );
    default:
      return <span data-testid={testId}>{children}</span>;
  }
}

// ---- Link (anchor with button/muted look) ----

// isSafeHref lives in @cosmicdrift/kumiko-renderer/headless — shared with
// page-render's server-side markdown renderer, both take untrusted
// tenant-authored hrefs.

// `button` uses the primary button surface on a semantic <a>, the
// standard for "continue to" navigations after success states (formerly
// authButtonClass), `muted` is the subtle secondary link (formerly
// authMutedLinkClass).
// Modified and middle clicks keep the browser default (new tab/window).
export function isPlainPrimaryClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function DefaultLink({
  href,
  variant = "default",
  target,
  rel,
  onPress,
  className,
  children,
  testId,
  dataAttributes,
}: LinkProps): ReactNode {
  const variantClass =
    variant === "button"
      ? buttonVariants({ variant: "default" })
      : variant === "muted"
        ? "text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        : "text-primary underline-offset-4 hover:underline";
  return (
    <a
      href={isSafeHref(href) ? href : "#"}
      target={target}
      rel={rel ?? (target === "_blank" ? "noopener noreferrer" : undefined)}
      {...dataAttributes}
      data-testid={testId}
      className={cn(variantClass, className)}
      onClick={
        onPress === undefined
          ? undefined
          : (event) => {
              if (!isPlainPrimaryClick(event)) return;
              event.preventDefault();
              onPress();
            }
      }
    >
      {children}
    </a>
  );
}

export function DefaultProgress({ value, tone, ariaLabel, testId }: ProgressProps): ReactNode {
  return <ProgressBar value={value} tone={tone} ariaLabel={ariaLabel} testId={testId} />;
}

export function DefaultStepBar({
  steps,
  currentIndex,
  compactLabel,
  onStepSelect,
  doneSteps,
  selectableSteps,
  narrowLayout,
  orientation,
  heading,
  description,
  subtitles,
  upNext,
  testId,
  compactTestId,
}: StepBarProps): ReactNode {
  return (
    <StepBar
      steps={steps}
      currentIndex={currentIndex}
      compactLabel={compactLabel}
      onStepSelect={onStepSelect}
      doneSteps={doneSteps}
      selectableSteps={selectableSteps}
      narrowLayout={narrowLayout}
      orientation={orientation}
      heading={heading}
      description={description}
      subtitles={subtitles}
      upNext={upNext}
      testId={testId}
      compactTestId={compactTestId}
    />
  );
}

export function DefaultWizardStepGroup({
  hidden,
  inset,
  children,
}: WizardStepGroupProps): ReactNode {
  const visibleClass = inset === true ? "flex min-w-0 flex-col gap-4 p-6" : "contents";
  return (
    <fieldset disabled={hidden} hidden={hidden} className={hidden ? undefined : visibleClass}>
      {children}
    </fieldset>
  );
}

export function DefaultHeading({ variant = "page", children, testId }: HeadingProps): ReactNode {
  // Page heading = h1, very rare in an app (max 1 per screen).
  // Section heading = h2 with uppercase + muted-foreground, the same look as
  // the section header in forms, but usable as a standalone component for
  // demo pages and custom screens.
  if (variant === "section") {
    return (
      <h2
        data-testid={testId}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {children}
      </h2>
    );
  }
  if (variant === "group") {
    return (
      <h2 data-testid={testId} className="text-base font-semibold text-foreground">
        {children}
      </h2>
    );
  }
  return (
    <h1 data-testid={testId} className="text-xl font-semibold tracking-tight sm:text-2xl">
      {children}
    </h1>
  );
}
