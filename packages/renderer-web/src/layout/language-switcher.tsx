// LanguageSwitcher — Dropdown-Button der die App-Locale via
// LocaleResolver.setLocale umschaltet. Nutzt denselben self-rolled
// Popup-Mechanismus wie UserMenu/TenantSwitcher (kein Radix-Dep).
//
// Rendert gar nix wenn der Resolver keine setLocale-Methode anbietet
// (statischer Resolver) — App-Dev sieht dann sofort dass er einen
// stateful Resolver verdrahten muss, bevor der Switcher UI-sichtbar
// wird.
//
// Icon-Slot optional: das Framework zieht lucide-react nicht selbst
// rein; eine App die keinen Icon-Import will, kriegt den Globe-
// Unicode-Glyph (🌐) als Default.

import { useLocale } from "@kumiko/renderer";
import { type ClassValue, clsx } from "clsx";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type LocaleOption = {
  /** BCP-47-Code, z.B. "de", "en-US", "fr-CA". Wird 1:1 an
   *  resolver.setLocale() weitergereicht. */
  readonly code: string;
  /** Menschenlesbare Anzeige im Dropdown. */
  readonly label: string;
};

export type LanguageSwitcherProps = {
  /** Auswählbare Locales. Reihenfolge = Anzeige-Reihenfolge im Menü. */
  readonly locales: readonly LocaleOption[];
  /** Icon-Slot links neben dem Button-Label. Default: 🌐. */
  readonly icon?: ReactNode;
  /** aria-label + title des Triggers. Default: "Sprache". */
  readonly label?: string;
  readonly testId?: string;
};

export function LanguageSwitcher({
  locales,
  icon = "🌐",
  label = "Sprache",
  testId,
}: LanguageSwitcherProps): ReactNode {
  const resolver = useLocale();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent): void => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeLocale = resolver.locale();
  // Match entweder exact ("de-DE") oder Language-Root ("de") gegen die
  // verfügbaren Optionen. So zeigt der Switcher "Deutsch" aktiv wenn
  // der Browser "de-AT" liefert und die Option nur "de" heißt.
  const activeOption = useMemo(() => {
    const exact = locales.find((o) => o.code === activeLocale);
    if (exact) return exact;
    const root = activeLocale.split("-")[0];
    return locales.find((o) => o.code === root);
  }, [locales, activeLocale]);

  if (resolver.setLocale === undefined) {
    // Stateless-Resolver → kein Wechsel möglich. Kein Noise im Topbar.
    return null;
  }

  const handleSelect = (code: string): void => {
    setOpen(false);
    resolver.setLocale?.(code);
  };

  return (
    <div ref={containerRef} className="relative" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2 text-sm",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <span aria-hidden="true">{icon}</span>
        <span className="uppercase text-xs text-muted-foreground">
          {activeOption?.code ?? activeLocale.slice(0, 2)}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            "absolute right-0 z-50 mt-1 min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
            "animate-in fade-in-0 zoom-in-95",
          )}
        >
          {locales.map((opt) => {
            const isActive = opt === activeOption;
            return (
              <button
                key={opt.code}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(opt.code)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:bg-accent",
                )}
              >
                <span className="truncate">{opt.label}</span>
                {isActive && (
                  <span aria-hidden="true" className="text-xs">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
