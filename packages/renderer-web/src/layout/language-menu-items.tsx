import { useLocale, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useMemo } from "react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../primitives/dropdown-menu";
import type { LocaleOption } from "./language-switcher";

export type LanguageMenuItemsProps = {
  readonly locales: readonly LocaleOption[];
  readonly label?: string;
};

/** Locale choices as dropdown entries, for a user menu that carries the shell controls. */
export function LanguageMenuItems({ locales, label }: LanguageMenuItemsProps): ReactNode {
  const resolver = useLocale();
  const t = useTranslation();
  const activeLocale = resolver.locale();
  const activeOption = useMemo(
    () =>
      locales.find((o) => o.code === activeLocale) ??
      locales.find((o) => o.code === activeLocale.split("-")[0]),
    [locales, activeLocale],
  );
  const setLocale = resolver.setLocale;
  if (setLocale === undefined) return null;
  return (
    <>
      <DropdownMenuLabel>{label ?? t("kumiko.nav.language")}</DropdownMenuLabel>
      {locales.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.code}
          checked={option === activeOption}
          onSelect={() => setLocale(option.code)}
        >
          <span className="truncate">{option.label}</span>
        </DropdownMenuCheckboxItem>
      ))}
      <DropdownMenuSeparator />
    </>
  );
}
