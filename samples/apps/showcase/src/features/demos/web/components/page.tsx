// Shared page layout for the demo custom screens. Not a framework
// concept — pure sample layout that keeps the top action bar convention
// (h-12, bg-muted/30, border-b) consistent with form/list.

import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

export function DemoPage({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col w-full">
      <div
        data-testid="demo-page-header"
        className="h-12 px-6 bg-muted/30 border-b flex items-center gap-3"
      >
        <div className="text-base font-semibold tracking-tight truncate">{title}</div>
      </div>
      <div className="px-6 pt-6 pb-12 max-w-4xl flex flex-col gap-6">
        {description !== undefined && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        {children}
      </div>
    </div>
  );
}

// Section within a demo page: Card primitive (standard chrome). Samples
// are a copy template for agents → the same card as everywhere, no special layout.
export function DemoSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  const { Card } = usePrimitives();
  return (
    <Card slots={{ title }}>
      <div className="flex flex-col gap-3">{children}</div>
    </Card>
  );
}
