import type { AppSchema } from "@cosmicdrift/kumiko-renderer-web";
import { DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

// Logo-Kachel + Wortmarke — wie SidebarBrand (sidebar-brand.tsx). Die
// Kachel bleibt collapsed stehen (liest sich als Logo, nicht als
// zufaelliger Buchstabe), nur die Wortmarke daneben blendet aus.
const Brand = (): ReactNode => (
  <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
    <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
      <span className="text-sm font-semibold">C</span>
    </div>
    <span className="truncate font-semibold tracking-tight text-[var(--color-primary)] group-data-[collapsible=icon]:hidden">
      Config Demo
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
