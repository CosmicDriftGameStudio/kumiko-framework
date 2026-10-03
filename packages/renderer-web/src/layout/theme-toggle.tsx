// ThemeToggle — Button der die Theme-Wahl weiterschaltet (hell → dunkel → auto).
// Icon-Slots als Props, damit renderer-web keine Icon-Lib als Hard-
// Dependency zieht. Default: Unicode-Glyphs (☀ / ☾) — funktionieren in
// jedem Browser, jede App kann lucide/heroicons/eigene SVG via Props
// reinreichen.

import { type ReactNode, useContext } from "react";
import { HeaderOverflowMenuContext, headerOverflowMenuItemClass } from "./header-overflow-menu.js";
import { useThemeToggleLabel } from "./theme-label.js";

export type ThemeToggleProps = {
  /** Icon für den Schritt zum hellen Modus. Default: ☀ */
  readonly lightIcon?: ReactNode;
  /** Icon für den Schritt zum dunklen Modus. Default: ☾ */
  readonly darkIcon?: ReactNode;
  /** Icon für den Schritt zum automatischen Modus. Default: ◐ */
  readonly autoIcon?: ReactNode;
  /** Title/aria-label beim Schritt zum hellen Modus. Default: i18n `kumiko.theme.light` */
  readonly titleInDark?: string;
  /** Title/aria-label beim Schritt zum dunklen Modus. Default: i18n `kumiko.theme.dark` */
  readonly titleInLight?: string;
  /** Title/aria-label beim Schritt zum automatischen Modus. Default: i18n `kumiko.theme.auto` */
  readonly titleForAuto?: string;
  readonly testId?: string;
};

export function ThemeToggle({
  lightIcon = "☀",
  darkIcon = "☾",
  autoIcon = "◐",
  titleInDark,
  titleInLight,
  titleForAuto,
  testId,
}: ThemeToggleProps): ReactNode {
  const inOverflowMenu = useContext(HeaderOverflowMenuContext);
  const { nextPreference, title, cyclePreference } = useThemeToggleLabel({
    titleInDark,
    titleInLight,
    titleForAuto,
  });
  const icon = { light: lightIcon, dark: darkIcon, auto: autoIcon }[nextPreference];
  if (inOverflowMenu) {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={cyclePreference}
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
      onClick={cyclePreference}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title={title}
      aria-label={title}
      data-testid={testId}
    >
      {icon}
    </button>
  );
}
