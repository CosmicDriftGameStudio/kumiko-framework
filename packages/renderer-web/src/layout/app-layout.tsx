import type { ReactNode } from "react";

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
};

export function AppLayout({ topbar, sidebar, children, testId }: AppLayoutProps): ReactNode {
  return (
    <div
      data-testid={testId}
      data-kumiko-layout="app"
      className="flex min-h-screen flex-row bg-background text-foreground"
    >
      {sidebar}
      <div className="flex flex-1 min-w-0 flex-col">
        {topbar}
        {/* main hat KEIN Padding — Screens (Form, Liste, Demo-Pages)
             managen ihr Padding selber, damit Action-Bars edge-to-edge
             spannen können ohne Negative-Margin-Tricks die mit
             `position: sticky` kollidieren. */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
