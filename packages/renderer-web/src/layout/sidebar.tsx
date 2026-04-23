// Vertikale Leiste links. Nimmt children — im Nav-Tree-Schritt
// kommt hier ein strukturierter Tree rein; jetzt ist's ein
// flexibler Slot den der App-Dev beliebig füllt.
//
// Feste Breite per default (220px), override via width-Prop. Scroll
// wenn Inhalt länger ist als Viewport.

import type { CSSProperties, ReactNode } from "react";

export type SidebarProps = {
  readonly children: ReactNode;
  /** Breite der Sidebar in CSS-Einheit. Default "220px" — passt für
   *  einen typischen Nav-Tree mit ein- bis zweistelligen Einträgen. */
  readonly width?: string;
  readonly testId?: string;
};

export function Sidebar({ children, width = "220px", testId }: SidebarProps): ReactNode {
  const style: CSSProperties = {
    width,
    flexShrink: 0,
    background: "var(--kumiko-color-surface)",
    borderRight: "1px solid var(--kumiko-color-border)",
    padding: "var(--kumiko-spacing-md)",
    overflow: "auto",
    fontSize: "var(--kumiko-font-size-body)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--kumiko-spacing-xs)",
  };
  return (
    <aside data-testid={testId} data-kumiko-layout="sidebar" style={style}>
      {children}
    </aside>
  );
}
