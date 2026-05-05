// ThemeToggle — Button der useTokenController().toggleMode() aufruft.
// Icon-Slots als Props, damit renderer-web keine Icon-Lib als Hard-
// Dependency zieht. Default: Unicode-Glyphs (☀ / ☾) — funktionieren in
// jedem Browser, jede App kann lucide/heroicons/eigene SVG via Props
// reinreichen.

import { useTokenController } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export type ThemeToggleProps = {
  /** Icon für den hellen Modus (wird angezeigt WENN aktuell dark →
   *  Klick wechselt zu light). Default: ☀ */
  readonly lightIcon?: ReactNode;
  /** Icon für den dunklen Modus (wird angezeigt WENN aktuell light →
   *  Klick wechselt zu dark). Default: ☾ */
  readonly darkIcon?: ReactNode;
  /** Title/aria-label im dunklen Modus. Default: "Heller Modus" */
  readonly titleInDark?: string;
  /** Title/aria-label im hellen Modus. Default: "Dunkler Modus" */
  readonly titleInLight?: string;
  readonly testId?: string;
};

export function ThemeToggle({
  lightIcon = "☀",
  darkIcon = "☾",
  titleInDark = "Heller Modus",
  titleInLight = "Dunkler Modus",
  testId,
}: ThemeToggleProps): ReactNode {
  const { mode, toggleMode } = useTokenController();
  return (
    <button
      type="button"
      onClick={toggleMode}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title={mode === "dark" ? titleInDark : titleInLight}
      aria-label={mode === "dark" ? titleInDark : titleInLight}
      data-testid={testId}
    >
      {mode === "dark" ? lightIcon : darkIcon}
    </button>
  );
}
