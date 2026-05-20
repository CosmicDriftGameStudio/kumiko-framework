import type { AppSchema } from "@cosmicdrift/kumiko-renderer-web";
import { DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

const Brand = (): ReactNode => (
  <div className="flex items-center gap-2">
    <span className="font-semibold tracking-tight text-[var(--color-primary)]">Config Demo</span>
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
