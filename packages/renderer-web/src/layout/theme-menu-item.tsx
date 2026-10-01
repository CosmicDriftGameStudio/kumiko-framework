import { useOptionalTranslation, useTokenController } from "@cosmicdrift/kumiko-renderer";
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
  titleInDark,
  titleInLight,
  testId,
}: ThemeMenuItemProps): ReactNode {
  const { mode, toggleMode } = useTokenController();
  const isDark = mode === "dark";
  const translate = useOptionalTranslation();
  const title = isDark
    ? (titleInDark ?? translate?.("kumiko.theme.light") ?? "Light theme")
    : (titleInLight ?? translate?.("kumiko.theme.dark") ?? "Dark theme");
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
