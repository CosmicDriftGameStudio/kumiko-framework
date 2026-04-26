import type { ReactNode } from "react";

export type TopbarProps = {
  readonly start?: ReactNode;
  readonly center?: ReactNode;
  readonly end?: ReactNode;
  readonly testId?: string;
};

export function Topbar({ start, center, end, testId }: TopbarProps): ReactNode {
  return (
    <header
      data-testid={testId}
      data-kumiko-layout="topbar"
      className="flex h-12 items-center gap-4 border-b bg-muted/40 px-4 text-sm"
    >
      {start !== undefined && <div className="flex items-center gap-3">{start}</div>}
      {center !== undefined && <nav className="flex flex-1 items-center gap-6">{center}</nav>}
      {end !== undefined && <div className="ml-auto flex items-center gap-2">{end}</div>}
    </header>
  );
}
