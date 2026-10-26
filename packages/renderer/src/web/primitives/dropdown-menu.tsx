// shadcn-style DropdownMenu built on Radix. Wrappers around
// the radix-ui DropdownMenu use the same Tailwind token classes as
// the other primitives. The caller provides the trigger-button styling
// through the asChild pattern; this module supplies only Content, Item,
// Label, Separator, and CheckboxItem with consistent styling.
//
// Advantages over the custom useDropdownMenu hook:
// - Click-outside, Escape, focus trapping, roving tabindex, ARIA roles,
//   and pointer-versus-keyboard subtleties are handled by Radix.
// - Portaled content renders across stacking-context boundaries, which is
//   useful in dialogs and popovers.
// - Keyboard navigation (↑↓ + Home/End) works by default.

import { Check } from "lucide-react";
import { DropdownMenu as Primitive } from "radix-ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuPortal = Primitive.Portal;

const contentClass =
  "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 " +
  "text-popover-foreground shadow-md " +
  "data-[state=open]:animate-in data-[state=closed]:animate-out " +
  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 " +
  "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 " +
  "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2";

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  portalContainer,
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.Content> & {
  /** Mount point of the portal. Default: document.body, which sits outside every landmark. */
  readonly portalContainer?: HTMLElement | null;
}): ReactNode {
  return (
    <Primitive.Portal container={portalContainer}>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(contentClass, className)}
        {...props}
      />
    </Primitive.Portal>
  );
}

const itemClass =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm " +
  "outline-none transition-colors " +
  "focus:bg-accent focus:text-accent-foreground " +
  "data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function DropdownMenuItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.Item>): ReactNode {
  return <Primitive.Item className={cn(itemClass, className)} {...props} />;
}

// CheckboxItem with a check icon on the left for "selected item in a list"
// patterns (TenantSwitcher, LanguageSwitcher). Radix renders
// <ItemIndicator> only when checked=true, so no separate branch is needed.
export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.CheckboxItem>): ReactNode {
  return (
    <Primitive.CheckboxItem
      checked={checked}
      className={cn(itemClass, "pl-8 pr-2", className)}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.CheckboxItem>
  );
}

export const DropdownMenuRadioGroup = Primitive.RadioGroup;

// RadioItem with a dot indicator on the left — for exclusive single-choice
// selection (e.g. WorkspaceSwitcher). Unlike CheckboxItem, Radix renders
// role="menuitemradio" + aria-checked here instead of role="menuitemcheckbox",
// which announces "one of several" to screen readers instead of "on/off".
export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.RadioItem>): ReactNode {
  return (
    <Primitive.RadioItem className={cn(itemClass, "pl-8 pr-2", className)} {...props}>
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.Label>): ReactNode {
  return (
    <Primitive.Label
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.Separator>): ReactNode {
  return <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
