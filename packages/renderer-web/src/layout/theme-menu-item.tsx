import type { ReactNode } from "react";
import { DropdownMenuItem } from "../primitives/dropdown-menu.js";
import { useThemeToggleLabel } from "./theme-label.js";

export type ThemeMenuItemProps = {
  readonly lightIcon?: ReactNode;
  readonly darkIcon?: ReactNode;
  readonly titleInDark?: string;
  readonly titleInLight?: string;
  readonly testId?: string;
};

/** Theme toggle as a dropdown entry, for a user menu that carries the shell controls. */
export function ThemeMenuItem({
  lightIcon = "☀",
  darkIcon = "☾",
  titleInDark,
  titleInLight,
  testId,
}: ThemeMenuItemProps): ReactNode {
  const { isDark, title, toggleMode } = useThemeToggleLabel({ titleInDark, titleInLight });
  return (
    <DropdownMenuItem
      data-testid={testId}
      onSelect={(event) => {
        event.preventDefault();
        toggleMode();
      }}
    >
      <span aria-hidden="true">{isDark ? lightIcon : darkIcon}</span>
      <span>{title}</span>
    </DropdownMenuItem>
  );
}
