// Convenience-Wrapper für die drei häufigsten Layout-Slots: Topbar
// oben, Sidebar links, Main füllt den Rest. Reines CSS-Grid — keine
// Responsiveness, keine Collapse-Mechanik. Wer mobile-tauglich will,
// kombiniert Topbar/Sidebar/Main selbst (oder überschreibt dieses
// AppLayout in seinem Shell).
//
// Styling durchgehend über CSS-Variables — Tokens-Toggle schlägt
// automatisch durch.

import type { CSSProperties, ReactNode } from "react";

export type AppLayoutProps = {
  /** Optional — horizontale Leiste am oberen Bildschirmrand. Typisch
   *  eine <Topbar>-Komponente. Fehlt sie, füllt der Main-Bereich den
   *  verfügbaren Platz nach oben. */
  readonly topbar?: ReactNode;
  /** Optional — vertikale Leiste links. Typisch eine <Sidebar>-
   *  Komponente, später mit Nav-Tree gefüllt. Fehlt sie, füllt der
   *  Main-Bereich die volle Breite. */
  readonly sidebar?: ReactNode;
  /** Hauptinhalt. Scroll-fähig wenn der Inhalt länger ist als die
   *  verbleibende Höhe — der AppLayout-Wrapper selbst bleibt fix
   *  (100vh). */
  readonly children: ReactNode;
  readonly testId?: string;
};

export function AppLayout({ topbar, sidebar, children, testId }: AppLayoutProps): ReactNode {
  // CSS-grid-template-areas würde das elegant ausdrücken, ist aber
  // etwas fragil wenn sidebar/topbar fehlen (leere areas erzeugen
  // implizite Tracks). Stattdessen: Topbar als zweiter Container oben,
  // darunter ein Flex-Row aus Sidebar + Main.
  const shellStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    background: "var(--kumiko-color-background)",
    color: "var(--kumiko-color-text)",
  };
  const bodyStyle: CSSProperties = {
    display: "flex",
    flexDirection: "row",
    flex: 1,
    minHeight: 0,
  };
  const mainStyle: CSSProperties = {
    flex: 1,
    padding: "var(--kumiko-spacing-lg)",
    overflow: "auto",
  };
  return (
    <div data-testid={testId} data-kumiko-layout="app" style={shellStyle}>
      {topbar}
      <div style={bodyStyle}>
        {sidebar}
        <main style={mainStyle}>{children}</main>
      </div>
    </div>
  );
}
