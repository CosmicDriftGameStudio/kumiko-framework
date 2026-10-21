import type { IconKey } from "@cosmicdrift/kumiko-framework/ui-types";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import type { ButtonProps } from "../../index.ts";
import { NAV_ICONS } from "../icons.tsx";
import { cn } from "../lib/cn.ts";
import { Button as UiButton } from "../ui/button.tsx";
import "../react-css-custom-properties.ts";

// ---- Button (vendored shadcn ui/button) ----

// Contract variant -> shadcn variant: secondary has always been the
// bordered bg-background look = shadcn's `outline`. primary->default,
// danger->destructive, link->link (no bg, underline on hover).
const BUTTON_VARIANT = {
  primary: "default",
  secondary: "outline",
  danger: "destructive",
  link: "link",
  "danger-ghost": "ghost",
  ghost: "ghost",
} as const;

const BUTTON_SIZE = {
  sm: "sm",
  md: "default",
  icon: "icon",
} as const;

// Closed IconKey vocabulary, checked against the shared NAV_ICONS registry
// (icons.tsx) — an unknown key (schema data isn't statically typed against
// IconKey the way this prop is) renders no icon instead of crashing, same
// fallback shape as fieldIconFor above.
export function actionIconFor(icon: IconKey | undefined): IconKey | undefined {
  return icon !== undefined && Object.hasOwn(NAV_ICONS, icon) ? icon : undefined;
}

// Shared by DefaultButton's `secondary` variant and triggers that need Radix `asChild`
// prop forwarding (which DefaultButton does not support), so both stay visually identical.
export const SECONDARY_BUTTON_EXTRA_CLASSES = "border-input hover:bg-muted";

export function DefaultButton({
  type = "button",
  onClick,
  disabled,
  loading,
  variant = "primary",
  size = "md",
  ariaLabel,
  title,
  pressed,
  expanded,
  width = "auto",
  children,
  testId,
  className,
  ref,
  icon,
  iconEnd,
  dataAttributes,
}: ButtonProps): ReactNode {
  // The link variant renders text-like (inline link in running text/banner),
  // not as a padded surface; width="full" stretches CTA buttons in cards/panels.
  const resolvedClassName = cn(
    variant === "link" ? "h-auto px-0 py-0" : "",
    variant === "danger-ghost"
      ? "text-destructive hover:text-destructive hover:bg-destructive/10"
      : "",
    variant === "ghost" ? "text-primary hover:text-primary hover:bg-primary/10" : "",
    variant === "secondary" ? SECONDARY_BUTTON_EXTRA_CLASSES : "",
    pressed === true
      ? "border-primary/40 bg-accent text-accent-foreground ring-1 ring-primary/30"
      : "",
    width === "full" ? "w-full" : "",
    className,
  );
  const IconStart = icon !== undefined ? NAV_ICONS[icon] : undefined;
  const IconEnd = iconEnd !== undefined ? NAV_ICONS[iconEnd] : undefined;
  // Loading swaps the leading icon slot for a spinner and keeps `children` —
  // replacing the label would shift the button's width mid-submit.
  const leading =
    loading === true ? (
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
    ) : IconStart !== undefined ? (
      <IconStart className="size-4" aria-hidden="true" />
    ) : null;
  return (
    <UiButton
      ref={ref}
      type={type}
      onClick={onClick}
      disabled={disabled === true || loading === true}
      {...dataAttributes}
      data-testid={testId}
      data-loading={loading === true ? "true" : undefined}
      variant={BUTTON_VARIANT[variant]}
      size={BUTTON_SIZE[size]}
      aria-label={ariaLabel}
      aria-pressed={pressed}
      aria-expanded={expanded}
      title={title ?? (size === "icon" ? ariaLabel : undefined)}
      className={resolvedClassName}
    >
      {leading}
      {children}
      {IconEnd !== undefined && <IconEnd className="size-4" aria-hidden="true" />}
    </UiButton>
  );
}
