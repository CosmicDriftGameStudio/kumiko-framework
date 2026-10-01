// ThemeToggle — Button der useTokenController().toggleMode() aufruft.
// Icon-Slots als Props, damit renderer-web keine Icon-Lib als Hard-
// Dependency zieht. Default: Unicode-Glyphs (☀ / ☾) — funktionieren in
// jedem Browser, jede App kann lucide/heroicons/eigene SVG via Props
// reinreichen.

import { useOptionalTranslation, useTokenController } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useContext } from "react";
import { HeaderOverflowMenuContext, headerOverflowMenuItemClass } from "./header-overflow-menu.js";

export type ThemeToggleProps = {
  /** Icon für den hellen Modus (wird angezeigt WENN aktuell dark →
   *  Klick wechselt zu light). Default: ☀ */
  readonly lightIcon?: ReactNode;
  /** Icon für den dunklen Modus (wird angezeigt WENN aktuell light →
   *  Klick wechselt zu dark). Default: ☾ */
  readonly darkIcon?: ReactNode;
  /** Title/aria-label im dunklen Modus. Default: i18n `kumiko.theme.light` */
  readonly titleInDark?: string;
  /** Title/aria-label im hellen Modus. Default: i18n `kumiko.theme.dark` */
  readonly titleInLight?: string;
  readonly testId?: string;
};

export function ThemeToggle({
  lightIcon = "☀",
  darkIcon = "☾",
  titleInDark,
  titleInLight,
  testId,
}: ThemeToggleProps): ReactNode {
  const { mode, toggleMode } = useTokenController();
  const inOverflowMenu = useContext(HeaderOverflowMenuContext);
  // Optional: the toggle also renders outside a LocaleProvider (samples, tests).
  const translate = useOptionalTranslation();
  const isDark = mode === "dark";
  const title = isDark
    ? (titleInDark ?? translate?.("kumiko.theme.light") ?? "Light theme")
    : (titleInLight ?? translate?.("kumiko.theme.dark") ?? "Dark theme");
  const icon = isDark ? lightIcon : darkIcon;
  if (inOverflowMenu) {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={toggleMode}
        className={headerOverflowMenuItemClass}
        data-testid={testId}
      >
        <span aria-hidden="true">{icon}</span>
        <span>{title}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={toggleMode}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title={title}
      aria-label={title}
      data-testid={testId}
    >
      {icon}
    </button>
  );
}
