import type { AppSchema } from "@cosmicdrift/kumiko-renderer-web";
import { DefaultAppShell } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

// Zwei Fassungen statt einer: auf Icon-Breite hat ein mehrwortiger Name
// keinen Platz, er bricht um und schiebt sich unter die Rail. Das Kuerzel
// haelt die Kopfzeile auf einer Zeile.
const Brand = (): ReactNode => (
  <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
    <span className="truncate font-semibold tracking-tight text-[var(--color-primary)] group-data-[collapsible=icon]:hidden">
      Config Demo
    </span>
    <span
      aria-hidden="true"
      className="hidden font-semibold tracking-tight text-[var(--color-primary)] group-data-[collapsible=icon]:inline"
    >
      C
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
