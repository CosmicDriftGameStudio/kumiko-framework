import type { ReactNode } from "react";
import type { BannerProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import "../react-css-custom-properties.ts";
import { fieldLabelId } from "./field.tsx";

// ---- Banner (shadcn: Alert) ----

export function DefaultBanner({
  variant = "info",
  title,
  titleTestId,
  children,
  actions,
  padded,
  testId,
  id,
}: BannerProps): ReactNode {
  const isError = variant === "error";
  const isWarning = variant === "warning";
  const isPrimary = variant === "primary";
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
      className={cn(
        "relative w-full rounded-lg border px-4 py-3 text-sm flex items-center gap-3",
        // Viewport breakpoint like the form footer bar; actions drop below the text on phones.
        isPrimary && "flex-col items-start sm:flex-row sm:items-center",
        isError
          ? "border-destructive/50 text-destructive bg-destructive/10 dark:border-destructive"
          : isWarning
            ? "border-status-warn/30 bg-status-warn/10 text-status-warn"
            : isPrimary
              ? "border-l-4 border-l-primary bg-card text-card-foreground"
              : "bg-card text-card-foreground",
      )}
    >
      <div className="flex-1">
        {title !== undefined && (
          <div data-testid={titleTestId} className="font-semibold">
            {title}
          </div>
        )}
        {children}
      </div>
      {actions !== undefined && <div data-slot="actions">{actions}</div>}
    </div>
  );
  // Page state: the banner sits alone in main (which no longer has padding).
  // The wrapper adds 24px outer spacing so the banner does not stick
  // edge-to-edge to the sidebar/browser.
  return padded === true ? <div className="p-6">{banner}</div> : banner;
}
