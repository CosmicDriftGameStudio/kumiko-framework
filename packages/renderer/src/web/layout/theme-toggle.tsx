// ThemeToggle — Button that cycles through the theme choices (light → dark → auto).
// Icon slots are props so renderer/web does not pull in an icon library as a hard
// dependency. Defaults: Unicode glyphs (☀ / ☾) — they work in every browser, and
// each app can pass lucide/heroicons/custom SVGs through the props.

import { type ReactNode, useContext } from "react";
import { HeaderOverflowMenuContext, headerOverflowMenuItemClass } from "./header-overflow-menu.ts";
import { useThemeToggleLabel } from "./theme-label.ts";

export type ThemeToggleProps = {
  /** Icon for the step to light mode. Default: ☀ */
  readonly lightIcon?: ReactNode;
  /** Icon for the step to dark mode. Default: ☾ */
  readonly darkIcon?: ReactNode;
  /** Icon for the step to auto mode. Default: ◐ */
  readonly autoIcon?: ReactNode;
  /** Title/aria-label for the step to light mode. Default: i18n `kumiko.theme.light` */
  readonly titleInDark?: string;
  /** Title/aria-label for the step to dark mode. Default: i18n `kumiko.theme.dark` */
  readonly titleInLight?: string;
  /** Title/aria-label for the step to auto mode. Default: i18n `kumiko.theme.auto` */
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
