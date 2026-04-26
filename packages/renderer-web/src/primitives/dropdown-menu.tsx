// shadcn-style DropdownMenu auf Radix-Basis. Wrappers um
// @radix-ui/react-dropdown-menu mit den Tailwind-Token-Klassen die
// die anderen Primitives auch nutzen — Trigger-Button-Look kommt vom
// Caller (asChild-Pattern), wir liefern nur Content/Item/Label/
// Separator/CheckboxItem mit konsistenter Optik.
//
// Vorteile gegenüber dem self-rolled useDropdownMenu-Hook:
//  - Click-outside, Escape, Focus-Trap, Roving-Tabindex, ARIA-Roles,
//    Pointer-vs-Keyboard-Subtleties — alles geschenkt von Radix.
//  - Portal'd Content rendert über Stacking-Context-Grenzen (nützlich
//    in Dialogs/Popovers).
//  - Keyboard-Nav (↑↓ + Home/End) funktioniert von Haus aus.

import * as Primitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../lib/cn";

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
  ...props
}: ComponentPropsWithoutRef<typeof Primitive.Content>): ReactNode {
  return (
    <Primitive.Portal>
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

// CheckboxItem mit Check-Icon links — für "ausgewählter Eintrag in
// einer Liste"-Patterns (TenantSwitcher, LanguageSwitcher). Radix
// rendert <ItemIndicator> nur wenn checked=true, kein eigener Branch
// nötig.
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
