import { useTokenController } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { DropdownMenuItem } from "../primitives/dropdown-menu.js";

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
  titleInDark = "Heller Modus",
  titleInLight = "Dunkler Modus",
  testId,
}: ThemeMenuItemProps): ReactNode {
  const { mode, toggleMode } = useTokenController();
  const isDark = mode === "dark";
  return (
    <DropdownMenuItem
      data-testid={testId}
      onSelect={(event) => {
        event.preventDefault();
        toggleMode();
      }}
    >
      <span aria-hidden="true">{isDark ? lightIcon : darkIcon}</span>
      <span>{isDark ? titleInDark : titleInLight}</span>
    </DropdownMenuItem>
  );
}
