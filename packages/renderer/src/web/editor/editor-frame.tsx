import type { ReactNode } from "react";
import { cn } from "../lib/cn.ts";

export type InfoBarTone = "active" | "muted" | "warn";

const INFO_BAR_TONE: Readonly<Record<InfoBarTone, string>> = {
  active: "bg-primary/10",
  muted: "bg-muted",
  warn: "bg-status-warn-surface",
};

// Height below the shell header: the rails and the center scroll on their own.
export function EditorFrame({
  testId,
  children,
}: {
  readonly testId: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      className="flex h-[calc(100svh-var(--shell-header-height))] min-h-[600px] flex-col"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function EditorInfoBar({
  tone,
  testId,
  origin,
  controls,
  links,
  overlays,
  children,
}: {
  readonly tone: InfoBarTone;
  readonly testId: string;
  /** Badge in front of the text: where the content comes from. */
  readonly origin?: ReactNode;
  /** Right side, before the links: locale switch and the editor's secondary action. */
  readonly controls?: ReactNode;
  readonly links?: ReactNode;
  readonly overlays?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <>
      <div
        className={cn("flex items-start gap-4 border-b px-6 py-2 text-sm", INFO_BAR_TONE[tone])}
        data-testid={testId}
        data-variant={tone === "warn" ? "warn" : undefined}
      >
        <span className="min-w-0 flex-1">
          {origin} {children}
        </span>
        {controls !== undefined && (
          <div className="flex shrink-0 items-center gap-2">{controls}</div>
        )}
        {links !== undefined && <div className="flex shrink-0 items-center gap-4">{links}</div>}
      </div>
      {overlays}
    </>
  );
}

export function EditorBody({
  left,
  center,
  right,
  testId,
}: {
  readonly left?: ReactNode;
  readonly center: ReactNode;
  readonly right: ReactNode;
  readonly testId?: string;
}): ReactNode {
  const centerColumn = (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted">{center}</div>
  );
  if (left === undefined) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_280px]" data-testid={testId}>
        {centerColumn}
        <aside className="min-h-0 overflow-y-auto border-l bg-background">{right}</aside>
      </div>
    );
  }
  // Three columns leave a narrow window (1024px beside the app sidebar) too little room for the
  // page: there both rails share the left column, one below the other, and the center keeps its width.
  // The rail column is display:contents while wide, so both rails stay grid items of their own.
  return (
    <div className="@container flex min-h-0 min-w-0 flex-1" data-testid={testId}>
      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[240px_minmax(0,1fr)_280px] @max-4xl:grid-cols-[240px_minmax(0,1fr)]">
        <div className="contents @max-4xl:block @max-4xl:min-h-0 @max-4xl:overflow-y-auto @max-4xl:border-r @max-4xl:bg-background">
          <aside className="min-h-0 overflow-y-auto border-r bg-background @max-4xl:overflow-visible @max-4xl:border-r-0 @max-4xl:border-b">
            {left}
          </aside>
          <aside className="order-last min-h-0 overflow-y-auto border-l bg-background @max-4xl:overflow-visible @max-4xl:border-l-0">
            {right}
          </aside>
        </div>
        {centerColumn}
      </div>
    </div>
  );
}
