// AppShell für Marketing-Demo. DefaultAppShell mit Brand-Wortmarke
// „Kumiko Demo", Light-Mode-default (kein Theme-Toggle für screenshots
// damit immer der gleiche Look).

import { type AppSchema, DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

// Zwei Fassungen statt einer: auf Icon-Breite haben Wortmarke + Badge
// keinen Platz, sie brechen um und schieben sich unter die Rail. Das
// Kuerzel haelt die Kopfzeile auf einer Zeile.
const Brand = (): ReactNode => (
  <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
    <span className="truncate font-semibold tracking-tight text-[var(--color-primary)] group-data-[collapsible=icon]:hidden">
      Kumiko Demo
    </span>
    <span className="text-xs px-1.5 py-0.5 rounded mono text-muted-foreground border border-border group-data-[collapsible=icon]:hidden">
      acme corp
    </span>
    <span
      aria-hidden="true"
      className="hidden font-semibold tracking-tight text-[var(--color-primary)] group-data-[collapsible=icon]:inline"
    >
      K
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
