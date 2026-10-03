import type { ReactNode } from "react";
import { DropdownMenuItem } from "../primitives/dropdown-menu.js";
import { useThemeToggleLabel } from "./theme-label.js";

export type ThemeMenuItemProps = {
  readonly lightIcon?: ReactNode;
  readonly darkIcon?: ReactNode;
  readonly autoIcon?: ReactNode;
  readonly titleInDark?: string;
  readonly titleInLight?: string;
  readonly titleForAuto?: string;
  readonly testId?: string;
};

/** Theme toggle as a dropdown entry, for a user menu that carries the shell controls. */
export function ThemeMenuItem({
  lightIcon = "☀",
  darkIcon = "☾",
  autoIcon = "◐",
  titleInDark,
  titleInLight,
  titleForAuto,
  testId,
}: ThemeMenuItemProps): ReactNode {
  const { nextPreference, title, cyclePreference } = useThemeToggleLabel({
    titleInDark,
    titleInLight,
    titleForAuto,
  });
  const icons = { light: lightIcon, dark: darkIcon, auto: autoIcon };
  return (
    <DropdownMenuItem
      data-testid={testId}
      onSelect={(event) => {
        event.preventDefault();
        cyclePreference();
      }}
    >
      <span aria-hidden="true">{icons[nextPreference]}</span>
      <span>{title}</span>
    </DropdownMenuItem>
  );
}
