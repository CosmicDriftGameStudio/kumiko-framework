import type { ReactNode } from "react";

// Convenience-Wrapper: Topbar oben, Sidebar links, Main füllt den
// Rest. Tailwind-Klassen referenzieren die shadcn-CSS-Vars — Theme-
// Toggle greift automatisch.

export type AppLayoutProps = {
  readonly topbar?: ReactNode;
  readonly sidebar?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
};

export function AppLayout({ topbar, sidebar, children, testId }: AppLayoutProps): ReactNode {
  return (
    <div
      data-testid={testId}
      data-kumiko-layout="app"
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      {topbar}
      <div className="flex flex-1 min-h-0 flex-row">
        {sidebar}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
