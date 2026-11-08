import type { ReactNode } from "react";
import type { BannerProps } from "../../index.ts";
import { Icon } from "../icons.tsx";
import { cn } from "../lib/cn.ts";
import "../react-css-custom-properties.ts";
import { fieldLabelId } from "./field.tsx";
import { useIsBelowSmViewport } from "./use-narrow-viewport.ts";

// ---- Banner (shadcn: Alert) ----

type BannerVariant = NonNullable<BannerProps["variant"]>;

const ICON_COLOR_CLASS: Record<BannerVariant, string> = {
  hint: "text-primary",
  info: "text-primary",
  primary: "text-primary",
  assist: "text-primary",
  ok: "text-status-ok",
  warning: "text-status-warn",
  error: "text-destructive",
  loading: "text-muted-foreground",
};

function variantClass(variant: BannerVariant, compact: boolean): string {
  switch (variant) {
    case "error":
      return "border-destructive/50 text-destructive bg-destructive/10 dark:border-destructive";
    case "warning":
      return "border-status-warn/30 bg-status-warn-surface text-status-warn";
    case "ok":
      return "border-status-ok/30 bg-status-ok-surface text-foreground";
    case "primary":
      return "border-l-4 border-l-primary bg-card text-card-foreground";
    case "assist":
      return "rounded-[9px] border-transparent border-l-[3px] border-l-primary bg-secondary px-3 py-2.5 text-primary font-medium";
    case "hint":
      return compact
        ? "border-border bg-card text-foreground"
        : "border-transparent bg-muted text-foreground";
    default:
      return "bg-card text-card-foreground";
  }
}

function BannerParts({ parts }: { readonly parts: BannerProps["parts"] }): ReactNode {
  // Parts are a static ordered list; the occurrence counter keeps repeated texts (separators) unique.
  const seen = new Map<string, number>();
  return parts?.map((part) => {
    const base = `${part.strong === true ? "strong" : "plain"}:${part.text}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    const key = `${base}:${occurrence}`;
    return part.strong === true ? (
      <strong key={key} className="font-semibold">
        {part.text}
      </strong>
    ) : (
      <span key={key}>{part.text}</span>
    );
  });
}

function BannerText({
  compact,
  title: fullTitle,
  narrowTitle,
  narrowText,
  titleTestId,
  children: fullText,
  parts,
  actionsBelow,
  inline,
  wrapsActions,
}: Pick<
  BannerProps,
  "title" | "narrowTitle" | "narrowText" | "titleTestId" | "children" | "parts"
> & {
  readonly compact: boolean;
  readonly inline: boolean;
  readonly wrapsActions: boolean;
  readonly actionsBelow: ReactNode;
}): ReactNode {
  const narrow = useIsBelowSmViewport();
  const title = narrow && narrowTitle !== undefined ? narrowTitle : fullTitle;
  const showsNarrowText = narrow && narrowText !== undefined;
  const children = showsNarrowText ? narrowText : fullText;
  const text = { title, children, showsNarrowText, titleTestId, parts, wrapsActions };
  if (inline && !compact && title !== undefined) return <InlineTitledBannerText {...text} />;
  if (compact || inline) return <CompactBannerText inline={inline} {...text} />;
  return (
    <div className="min-w-0 flex-1">
      {title !== undefined && (
        <div data-testid={titleTestId} className="font-semibold">
          {title}
        </div>
      )}
      {children}
      {!showsNarrowText && <BannerParts parts={parts} />}
      {actionsBelow}
    </div>
  );
}

type ResolvedBannerText = Pick<BannerProps, "titleTestId" | "parts"> & {
  readonly title: ReactNode;
  readonly children: ReactNode;
  readonly showsNarrowText: boolean;
  readonly wrapsActions: boolean;
};

function InlineTitledBannerText({
  title,
  children,
  showsNarrowText,
  titleTestId,
  parts,
  wrapsActions,
}: ResolvedBannerText): ReactNode {
  return (
    <div className={cn("min-w-0 grow", wrapsActions && "max-sm:min-w-[10rem] max-sm:basis-0")}>
      <div
        data-testid={titleTestId}
        className={cn(
          "text-xs text-muted-foreground",
          !showsNarrowText && "max-sm:text-sm max-sm:font-semibold max-sm:text-foreground",
        )}
      >
        {title}
      </div>
      <div className={cn(!showsNarrowText && "max-sm:hidden")}>
        {children}
        {!showsNarrowText && <BannerParts parts={parts} />}
      </div>
    </div>
  );
}

function CompactBannerText({
  inline,
  title,
  children,
  showsNarrowText,
  titleTestId,
  parts,
  wrapsActions,
}: ResolvedBannerText & { readonly inline: boolean }): ReactNode {
  return (
    <div className={cn("min-w-0 grow", wrapsActions && "max-sm:min-w-[10rem] max-sm:basis-0")}>
      {title !== undefined && (
        <>
          <strong data-testid={titleTestId} className="font-semibold">
            {title}
          </strong>{" "}
        </>
      )}
      <span className={cn(inline && !showsNarrowText && "max-sm:hidden")}>
        {children}
        {!showsNarrowText && <BannerParts parts={parts} />}
      </span>
    </div>
  );
}

function bannerLayoutClass(
  variant: BannerVariant,
  compact: boolean,
  actionsBelow: boolean,
  wrapsActions: boolean,
): string {
  return cn(
    "relative flex w-full items-center border",
    compact ? "gap-2 rounded-md px-2.5 py-2 text-[13px]" : "gap-3 rounded-lg px-3.5 py-2.5 text-sm",
    // Viewport breakpoint like the form footer bar; actions drop below the text on phones.
    !compact &&
      !actionsBelow &&
      variant === "primary" &&
      "flex-col items-start sm:flex-row sm:items-center",
    actionsBelow && "items-start",
    wrapsActions && "max-sm:flex-wrap",
    variantClass(variant, compact),
  );
}

// On phones the actions leave the text line and wrap below it instead of squeezing the text.
function wrapsActionsOnPhone(
  variant: BannerVariant,
  compact: boolean,
  actionsBelow: boolean,
  hasActions: boolean,
): boolean {
  return !compact && !actionsBelow && hasActions && variant !== "primary";
}

export function DefaultBanner({
  variant = "info",
  density = "default",
  icon,
  title,
  narrowTitle,
  narrowText,
  titleTestId,
  children,
  parts,
  actions,
  actionsPlacement = "end",
  padded,
  inline = false,
  testId,
  id,
}: BannerProps): ReactNode {
  const isError = variant === "error";
  const compact = density === "compact";
  // A compact banner is one line, so its actions always stay at the end.
  const actionsBelow = actionsPlacement === "below" && !compact && actions !== undefined;
  const wrapsActions = wrapsActionsOnPhone(variant, compact, actionsBelow, actions !== undefined);
  // `id` is set when a <Field> wraps this Banner as its control (see
  // BannerProps.id). A <div> isn't labelable, so a <label htmlFor> pointing
  // at it is inert for screen readers — role="group" + aria-labelledby is
  // the actual mechanism, pointed at the label id Field emits (fieldLabelId).
  const bannerRole = id !== undefined ? "group" : isError ? "alert" : undefined;
  const banner = (
    <div
      role={bannerRole}
      {...(id !== undefined && { "aria-labelledby": fieldLabelId(id) })}
      data-testid={testId}
      data-variant={variant}
      data-density={density}
      className={bannerLayoutClass(variant, compact, actionsBelow, wrapsActions)}
    >
      {icon !== undefined && (
        <Icon name={icon} className={cn("size-3.5 shrink-0", ICON_COLOR_CLASS[variant])} />
      )}
      <BannerText
        compact={compact}
        inline={inline}
        wrapsActions={wrapsActions}
        title={title}
        narrowTitle={narrowTitle}
        narrowText={narrowText}
        titleTestId={titleTestId}
        parts={parts}
        actionsBelow={
          actionsBelow ? (
            <div data-slot="actions" className="mt-3 flex flex-wrap gap-2">
              {actions}
            </div>
          ) : undefined
        }
      >
        {children}
      </BannerText>
      {!actionsBelow && actions !== undefined && (
        <div
          data-slot="actions"
          className={cn(
            compact && "shrink-0",
            wrapsActions && "max-sm:flex max-sm:w-full max-sm:flex-wrap max-sm:gap-2",
          )}
        >
          {actions}
        </div>
      )}
    </div>
  );
  // Page state: the banner sits alone in main (which no longer has padding).
  // The wrapper adds 24px outer spacing so the banner does not stick
  // edge-to-edge to the sidebar/browser.
  return padded === true ? <div className="p-6">{banner}</div> : banner;
}
