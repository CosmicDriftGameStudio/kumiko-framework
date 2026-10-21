import { cva } from "class-variance-authority";
import "../react-css-custom-properties.ts";

// ---- Card chrome (one definition for form/section/card) ----

// The one card surface. Dimensions (padding/radius/shadow) come from --card-*
// CSS tokens (defaults in styles.css) so an app can override them once,
// centrally, in its styles.css, like the colors. Radius variant:
// xl = card/screen surface (default, token-driven), lg = "inner" surface.
export const cardSurface = cva(
  "flex flex-col border bg-card text-card-foreground shadow-[var(--card-shadow)]",
  {
    variants: { radius: { xl: "rounded-[var(--card-radius)]", lg: "rounded-lg" } },
    defaultVariants: { radius: "xl" },
  },
);

// Wraps instead of running off-screen when the row outgrows its container.
export const cardFooter = "flex flex-wrap items-center justify-end gap-2 py-4";

export const cardFooterInset = "px-[var(--card-padding)]";

// /30 read as nearly invisible against the light-theme card (white card,
// muted at 94% lightness) — /50 keeps the same token, just a stronger step.
export const cardFooterBorder = "border-t bg-muted/50";

export const cardHeaderBorder = "border-b bg-muted/50";
