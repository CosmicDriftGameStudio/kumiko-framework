import {
  DefaultTopbarActions,
  useShellUser,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { type AppSchema, WorkspaceShell } from "@cosmicdrift/kumiko-renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";

const APP_NAME = "Admin Console";

// Logo-Kachel + Wortmarke — wie SidebarBrand (sidebar-brand.tsx). Die
// Kachel bleibt collapsed stehen (liest sich als Logo, nicht als
// zufaelliger Buchstabe), nur die Wortmarke daneben blendet aus.
const Brand = (): ReactNode => (
  <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
    <div className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
      <span className="text-sm font-semibold">{APP_NAME.charAt(0)}</span>
    </div>
    <strong className="truncate text-foreground tracking-tight group-data-[collapsible=icon]:hidden">
      {APP_NAME}
    </strong>
  </div>
);

export function AppShell({
  children,
  schema,
}: {
  readonly children: ReactNode;
  readonly schema: AppSchema;
}): ReactNode {
  const user = useShellUser();
  return (
    <WorkspaceShell
      brand={<Brand />}
      schema={schema}
      topbarActions={
        <DefaultTopbarActions
          lightIcon={<Sun className="h-4 w-4" />}
          darkIcon={<MoonStar className="h-4 w-4" />}
        />
      }
      {...(user !== undefined && { user })}
    >
      {children}
    </WorkspaceShell>
  );
}
