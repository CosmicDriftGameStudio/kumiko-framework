// AppShell mit WorkspaceShell statt DefaultAppShell — Multi-Persona-
// App mit URL-driven Workspace-Switch und Nav-Tree-Filter pro Rolle.

import {
  DefaultTopbarActions,
  useShellUser,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { type AppSchema, WorkspaceShell } from "@cosmicdrift/kumiko-renderer-web";
import { MoonStar, Sun } from "lucide-react";
import type { ReactNode } from "react";

const APP_NAME = "Kumiko Workspaces Demo";

// Zwei Fassungen statt einer: auf Icon-Breite hat ein mehrwortiger Name
// keinen Platz, er bricht um und schiebt sich unter die Rail. Das Kuerzel
// haelt die Kopfzeile auf einer Zeile.
const Brand = (): ReactNode => (
  <>
    <strong className="truncate text-foreground tracking-tight group-data-[collapsible=icon]:hidden">
      {APP_NAME}
    </strong>
    <strong
      aria-hidden="true"
      className="hidden text-foreground tracking-tight group-data-[collapsible=icon]:inline"
    >
      K
    </strong>
  </>
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
