// Demo component for the static `icon` field of a dashboard stat panel:
// resolved via the same extensionSectionComponents registry as custom panels,
// but ignores the entity/filter context (a plain icon has
// no relation to it).

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
