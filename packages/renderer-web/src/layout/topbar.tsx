// Horizontale Leiste am oberen Rand. Drei Slots — start (Brand,
// Logo), center (Hauptnav, meist <KumikoLink>-Liste), end (Actions
// wie Theme-Toggle, User-Menu, Tenant-Switcher). Alle Slots sind
// optional; der Layout fällt intelligent zurück wenn einer fehlt.

import type { CSSProperties, ReactNode } from "react";

export type TopbarProps = {
  readonly start?: ReactNode;
  readonly center?: ReactNode;
  readonly end?: ReactNode;
  readonly testId?: string;
};

export function Topbar({ start, center, end, testId }: TopbarProps): ReactNode {
  const barStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--kumiko-spacing-lg)",
    padding: "var(--kumiko-spacing-md) var(--kumiko-spacing-lg)",
    background: "var(--kumiko-color-surface)",
    borderBottom: "1px solid var(--kumiko-color-border)",
    fontSize: "var(--kumiko-font-size-body)",
  };
  const startStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--kumiko-spacing-md)",
  };
  const centerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--kumiko-spacing-lg)",
    flex: 1,
  };
  const endStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--kumiko-spacing-sm)",
    marginLeft: "auto",
  };
  return (
    <header data-testid={testId} data-kumiko-layout="topbar" style={barStyle}>
      {start !== undefined && <div style={startStyle}>{start}</div>}
      {center !== undefined && <nav style={centerStyle}>{center}</nav>}
      {end !== undefined && <div style={endStyle}>{end}</div>}
    </header>
  );
}
