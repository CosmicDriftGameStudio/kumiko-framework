// LanguageSwitcher — dropdown that switches the app locale via
// LocaleResolver.setLocale. Built on Radix DropdownMenu, same stack
// as UserMenu/TenantSwitcher.
//
// Renders nothing if the resolver doesn't offer a setLocale method
// (static resolver) — the app dev then immediately sees they need to
// wire up a stateful resolver before the switcher becomes visible in
// the UI.
//
// Icon slot is optional: the framework doesn't pull in lucide-react
// itself; an app that doesn't want an icon import gets the globe
// unicode glyph (🌐) as default.

import { useLocale, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useMemo } from "react";
import { cn } from "../lib/cn";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../primitives/dropdown-menu";

export type LocaleOption = {
  /** BCP-47 code, e.g. "de", "en-US", "fr-CA". Passed through 1:1 to
   *  resolver.setLocale(). */
  readonly code: string;
  /** Human-readable label shown in the dropdown. */
  readonly label: string;
};

export type LanguageSwitcherProps = {
  /** Selectable locales. Order = display order in the menu. */
  readonly locales: readonly LocaleOption[];
  /** Icon slot left of the button label. Default: 🌐. */
  readonly icon?: ReactNode;
  /** aria-label + title of the trigger. Default: translated "kumiko.nav.language". */
  readonly label?: string;
  readonly testId?: string;
};

export function LanguageSwitcher({
  locales,
  icon = "🌐",
  label,
  testId,
}: LanguageSwitcherProps): ReactNode {
  const resolver = useLocale();
  const t = useTranslation();
  const resolvedLabel = label ?? t("kumiko.nav.language");

  const activeLocale = resolver.locale();
  // Matches either exact ("de-DE") or the language root ("de") against
  // the available options. So the switcher shows "German" active when
  // the browser reports "de-AT" but the option is just "de".
  const activeOption = useMemo(() => {
    const exact = locales.find((o) => o.code === activeLocale);
    if (exact) return exact;
    const root = activeLocale.split("-")[0];
    return locales.find((o) => o.code === root);
  }, [locales, activeLocale]);

  if (resolver.setLocale === undefined) {
    // Stateless resolver → no switching possible. No noise in the topbar.
    return null;
  }

  const setLocale = resolver.setLocale;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={resolvedLabel}
          title={resolvedLabel}
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
      <DropdownMenuContent align="end" className="min-w-[10rem]" aria-label={resolvedLabel}>
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
