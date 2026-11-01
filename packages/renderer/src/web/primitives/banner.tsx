import type { ReactNode } from "react";
import type { BannerProps } from "../../index.ts";
import { Icon } from "../icons.tsx";
import { cn } from "../lib/cn.ts";
import "../react-css-custom-properties.ts";
import { fieldLabelId } from "./field.tsx";

// ---- Banner (shadcn: Alert) ----

type BannerVariant = NonNullable<BannerProps["variant"]>;

const ICON_COLOR_CLASS: Record<BannerVariant, string> = {
  hint: "text-primary",
  info: "text-primary",
  primary: "text-primary",
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
      return "border-status-warn/30 bg-status-warn/10 text-status-warn";
    case "ok":
      return "border-status-ok/30 bg-status-ok-surface text-foreground";
    case "primary":
      return "border-l-4 border-l-primary bg-card text-card-foreground";
    case "hint":
      return compact
        ? "border-border bg-card text-foreground"
        : "border-transparent bg-muted text-foreground";
    default:
      return "bg-card text-card-foreground";
  }
}

function BannerParts({ parts }: { readonly parts: BannerProps["parts"] }): ReactNode {
  return parts?.map((part) =>
    part.strong === true ? (
      <strong key={`strong:${part.text}`} className="font-semibold">
        {part.text}
      </strong>
    ) : (
      <span key={`plain:${part.text}`}>{part.text}</span>
    ),
  );
}

function BannerText({
  compact,
  title,
  titleTestId,
  children,
  parts,
  actionsBelow,
}: Pick<BannerProps, "title" | "titleTestId" | "children" | "parts"> & {
  readonly compact: boolean;
  readonly actionsBelow: ReactNode;
}): ReactNode {
  if (compact) {
    return (
      <div className="min-w-0 grow">
        {title !== undefined && (
          <>
            <strong data-testid={titleTestId} className="font-semibold">
              {title}
            </strong>{" "}
          </>
        )}
        {children}
        <BannerParts parts={parts} />
      </div>
    );
  }
  return (
    <div className="flex-1">
      {title !== undefined && (
        <div data-testid={titleTestId} className="font-semibold">
          {title}
        </div>
      )}
      {children}
      <BannerParts parts={parts} />
      {actionsBelow}
    </div>
  );
}

export function DefaultBanner({
  variant = "info",
  density = "default",
  icon,
  title,
  titleTestId,
  children,
  parts,
  actions,
  actionsPlacement = "end",
  padded,
  testId,
  id,
}: BannerProps): ReactNode {
  const isError = variant === "error";
  const compact = density === "compact";
  // A compact banner is one line, so its actions always stay at the end.
  const actionsBelow = actionsPlacement === "below" && !compact && actions !== undefined;
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
      className={cn(
        "relative flex w-full items-center border",
        compact ? "gap-2 rounded-md px-2.5 py-2 text-[13px]" : "gap-3 rounded-lg px-4 py-3 text-sm",
        // Viewport breakpoint like the form footer bar; actions drop below the text on phones.
        !compact &&
          !actionsBelow &&
          variant === "primary" &&
          "flex-col items-start sm:flex-row sm:items-center",
        actionsBelow && "items-start",
        variantClass(variant, compact),
      )}
    >
      {icon !== undefined && (
        <Icon name={icon} className={cn("size-3.5 shrink-0", ICON_COLOR_CLASS[variant])} />
      )}
      <BannerText
        compact={compact}
        title={title}
        titleTestId={titleTestId}
        parts={parts}
        actionsBelow={
          actionsBelow ? (
            <div data-slot="actions" className="mt-3">
              {actions}
            </div>
          ) : undefined
        }
      >
        {children}
      </BannerText>
      {!actionsBelow && actions !== undefined && (
        <div data-slot="actions" className={cn(compact && "shrink-0")}>
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
