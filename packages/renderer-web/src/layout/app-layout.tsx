import type { ReactNode } from "react";
import { cn } from "../lib/cn";

// Linear-Pattern: Sidebar ist Geschwister von <Topbar+Main>-Spalte,
// nimmt die volle Höhe. Wenn ein Topbar gesetzt ist, lebt er NUR über
// der Main-Spalte rechts neben der Sidebar. So wirkt die Sidebar als
// kontinuierlicher Chrome-Streifen mit eigener Identität, statt unter
// einer durchgehenden Kopfzeile geklemmt zu werden.

export type AppLayoutProps = {
  /** Optional. Lebt nur über dem Main-Bereich, nicht über der Sidebar. */
  readonly topbar?: ReactNode;
  readonly sidebar?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
  /** Viewport-fit Shell. true → Wurzel = `h-screen` (fixe Viewport-Höhe),
   *  Sidebar/Topbar bleiben stehen, der Main-Bereich scrollt INNEN
   *  (`min-h-0` + `overflow-auto`). false (Default) → klassischer
   *  `min-h-screen`-Flow, die ganze Seite scrollt. Dashboard-artige Apps
   *  wollen `true`; eine öffentliche, lange Content-Seite eher `false`.
   *  Clippt nie — der Content scrollt in `main` statt im Body. */
  readonly fill?: boolean;
  /** Optionaler Klassen-Append an die Wurzel (eigener Hintergrund etc.).
   *  Erweitert die Defaults, ersetzt sie nicht (cn-merge). */
  readonly className?: string;
  /** Optionaler Klassen-Append an `<main>`. */
  readonly mainClassName?: string;
};

export function AppLayout({
  topbar,
  sidebar,
  children,
  testId,
  fill,
  className,
  mainClassName,
}: AppLayoutProps): ReactNode {
  return (
    <div
      data-testid={testId}
      data-kumiko-layout="app"
      {...(fill === true && { "data-kumiko-fill": "true" })}
      className={cn(
        "flex flex-row bg-background text-foreground",
        fill === true ? "h-screen" : "min-h-screen",
        className,
      )}
    >
      {sidebar}
      <div className={cn("flex flex-1 min-w-0 flex-col", fill === true && "min-h-0")}>
        {topbar}
        {/* main hat KEIN Padding — Screens (Form, Liste, Demo-Pages)
             managen ihr Padding selber, damit Action-Bars edge-to-edge
             spannen können ohne Negative-Margin-Tricks die mit
             `position: sticky` kollidieren. */}
        <main className={cn("flex-1 overflow-auto", fill === true && "min-h-0", mainClassName)}>
          {children}
        </main>
      </div>
    </div>
  );
}
