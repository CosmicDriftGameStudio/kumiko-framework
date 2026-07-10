// Demo-Komponente für das statische `icon`-Feld eines Dashboard-stat-Panels:
// über dieselbe extensionSectionComponents-Registry wie custom-Panels
// aufgelöst, ignoriert aber den Entity-/Filter-Kontext (ein reines Icon hat
// keinen Bezug dazu).

import type { ReactNode } from "react";

export function DashboardKpiIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path d="M4 10h16M4 14h10" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
