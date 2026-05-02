// AppShell für Marketing-Demo. DefaultAppShell mit Brand-Wortmarke
// „Kumiko Demo", Light-Mode-default (kein Theme-Toggle für screenshots
// damit immer der gleiche Look).

import { type AppSchema, DefaultAppShell } from "@kumiko/renderer-web";
import type { ReactNode } from "react";

const Brand = (): ReactNode => (
  <div className="flex items-center gap-2">
    <span className="font-semibold tracking-tight text-[var(--color-primary)]">Kumiko Demo</span>
    <span className="text-xs px-1.5 py-0.5 rounded mono text-muted-foreground border border-border">
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
