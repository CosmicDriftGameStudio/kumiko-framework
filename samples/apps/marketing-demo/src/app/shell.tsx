// AppShell für Marketing-Demo. DefaultAppShell mit Brand-Wortmarke
// „Kumiko Demo", Light-Mode-default (kein Theme-Toggle für screenshots
// damit immer der gleiche Look).

import { type AppSchema, DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

// Logo-Kachel + Wortmarke — wie SidebarBrand (sidebar-brand.tsx). Die
// Kachel bleibt collapsed stehen (liest sich als Logo, nicht als
// zufaelliger Buchstabe), nur Wortmarke + Badge daneben blenden aus.
const Brand = (): ReactNode => (
  <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
    <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
      <span className="text-sm font-semibold">K</span>
    </div>
    <span className="truncate font-semibold tracking-tight text-[var(--color-primary)] group-data-[collapsible=icon]:hidden">
      Kumiko Demo
    </span>
    <span className="text-xs px-1.5 py-0.5 rounded mono text-muted-foreground border border-border group-data-[collapsible=icon]:hidden">
      acme corp
    </span>
  </div>
);

export function AppShell({
  children,
  schema,
}: {
  children: ReactNode;
  schema: AppSchema;
}): ReactNode {
  return (
    <DefaultAppShell schema={schema} brand={<Brand />}>
      {children}
    </DefaultAppShell>
  );
}
