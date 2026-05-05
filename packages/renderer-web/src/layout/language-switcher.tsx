// LanguageSwitcher — Dropdown der die App-Locale via
// LocaleResolver.setLocale umschaltet. Auf Radix-DropdownMenu, gleicher
// Stack wie UserMenu/TenantSwitcher.
//
// Rendert gar nix wenn der Resolver keine setLocale-Methode anbietet
// (statischer Resolver) — App-Dev sieht dann sofort dass er einen
// stateful Resolver verdrahten muss, bevor der Switcher UI-sichtbar
// wird.
//
// Icon-Slot optional: das Framework zieht lucide-react nicht selbst
// rein; eine App die keinen Icon-Import will, kriegt den Globe-
// Unicode-Glyph (🌐) als Default.

import { useLocale } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useMemo } from "react";
import { cn } from "../lib/cn";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../primitives/dropdown-menu";

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

  const setLocale = resolver.setLocale;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          data-testid={testId}
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
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]" aria-label={label}>
        {locales.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.code}
            checked={opt === activeOption}
            onSelect={() => setLocale(opt.code)}
          >
            <span className="truncate">{opt.label}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
