import type { ReactNode } from "react";

// Registered without access.roles (see home-feature in run-config.ts) - serves
// as createKumikoApp's default screenQn since admin-console otherwise only has
// role-gated screens. WorkspaceShell overrides the URL immediately for any
// user with workspace access; only visible for authenticated users without
// any workspace role.
export function HomeScreen(): ReactNode {
  return (
    <div data-testid="admin-console-home" className="p-6 text-muted-foreground">
      No workspace available for your account.
    </div>
  );
}
