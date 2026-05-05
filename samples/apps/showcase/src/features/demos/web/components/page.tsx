// Shared Page-Layout für die Demo-Custom-Screens. Kein Framework-
// Konzept — reines Sample-Layout, das die Top-Action-Bar Convention
// (h-12, bg-muted/30, border-b) konsistent mit Form/Liste hält.

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
      <div className="h-12 px-6 bg-muted/30 border-b flex items-center gap-3">
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

// Section innerhalb einer Demo-Page: Heading-Primitive + Inhalt-Box.
export function DemoSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}): ReactNode {
  const { Heading } = usePrimitives();
  return (
    <section className="flex flex-col gap-3">
      <Heading variant="section">{title}</Heading>
      <div className="flex flex-col gap-3 rounded-md border p-4">{children}</div>
    </section>
  );
}
