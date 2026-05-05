// WorkspaceSwitcher — dumb component for picking the active workspace.
// Receives the role-filtered + order-sorted workspace list, the active
// id, and a callback. Stays presentational so WorkspaceShell can own the
// state (URL ?w=, defaults, role filtering) and tests can hand any list
// in directly.

import type { WorkspaceSchema } from "@cosmicdrift/kumiko-renderer";
import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type WorkspaceSwitcherProps = {
  readonly workspaces: readonly WorkspaceSchema[];
  readonly activeId: string;
  readonly onSelect: (workspaceQn: string) => void;
  readonly testId?: string;
};

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSelect,
  testId,
}: WorkspaceSwitcherProps): ReactNode {
  const t = useTranslation();
  // Single workspace doesn't need a switcher — the user has no choice
  // anyway. Render nothing instead of a useless one-button row.
  if (workspaces.length <= 1) return null;
  return (
    <div
      data-testid={testId}
      data-kumiko-layout="workspace-switcher"
      role="tablist"
      className="flex items-center gap-1"
    >
      {workspaces.map((ws) => {
        const active = ws.definition.id === activeId;
        const label = ws.definition.label.includes(".")
          ? t(ws.definition.label)
          : ws.definition.label;
        return (
          <button
            type="button"
            key={ws.definition.id}
            role="tab"
            aria-selected={active}
            data-testid={`workspace-tab-${ws.definition.id}`}
            onClick={() => onSelect(ws.definition.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/40",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
