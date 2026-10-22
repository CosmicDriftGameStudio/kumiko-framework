import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

// Linear pattern: The sidebar is a sibling of the <Topbar+Main> column,
// spanning the full height. When a topbar is set, it exists ONLY above
// the main column to the right of the sidebar. This makes the sidebar a
// continuous chrome strip with its own identity instead of being trapped
// beneath a full-width header.

export type AppLayoutProps = {
  /** Optional. Exists only above the main area, not above the sidebar. */
  readonly topbar?: ReactNode;
  readonly sidebar?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
  /** Viewport-fit shell. Default `true` → root = `h-screen` (fixed
   *  viewport height); sidebar/topbar remain fixed while the main area
   *  scrolls INSIDE (`min-h-0` + `overflow-auto`). `false` → classic
   *  `min-h-screen` flow where the whole page scrolls—an escape hatch for
   *  a public, long content page that needs real body scrolling. Never
   *  clips—content scrolls in `main` instead of the body. */
  readonly fill?: boolean;
  /** Optional classes appended to the root (for a custom background, etc.).
   *  Extends the defaults rather than replacing them (`cn` merge). */
  readonly className?: string;
  /** Optionaler Klassen-Append an `<main>`. */
  readonly mainClassName?: string;
};

export function AppLayout({
  topbar,
  sidebar,
  children,
  testId,
  fill = true,
  className,
  mainClassName,
}: AppLayoutProps): ReactNode {
  return (
    <div
      data-testid={testId}
      data-kumiko-layout="app"
      {...(fill === true && { "data-kumiko-fill": "true" })}
      className={cn(
        // new-york inset frame: muted rail background; the sidebar sits
        // transparently on it, while the main area floats as its own panel.
        "flex flex-row bg-muted/40 text-foreground",
        fill === true ? "h-screen" : "min-h-screen",
        className,
      )}
    >
      {sidebar}
      <div
        className={cn(
          "flex flex-1 min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm m-2 md:ml-0",
          fill === true && "min-h-0",
        )}
      >
        {topbar}
        {/* main has NO padding—screens (forms, lists, demo pages) manage their own padding so
           action bars can span edge-to-edge without negative-margin tricks that conflict with
           `position: sticky`. */}
        <main className={cn("flex-1 overflow-auto", fill === true && "min-h-0", mainClassName)}>
          {children}
        </main>
      </div>
    </div>
  );
}
