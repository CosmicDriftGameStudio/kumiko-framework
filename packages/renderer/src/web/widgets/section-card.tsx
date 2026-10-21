import type { ReactNode } from "react";
import { usePrimitives } from "../../index.ts";

/** Section with a title and optional action slot (range switcher, filter) —
 * replaces repeated `<section className={CARD}>…<h2>` blocks in
 * custom screens. Thin wrapper around the Card primitive. */
export function SectionCard({
  title,
  subtitle,
  action,
  footer,
  children,
  testId,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly action?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly testId?: string;
}): ReactNode {
  const { Card } = usePrimitives();
  return (
    <Card slots={{ title, subtitle, headerActions: action, footer }} testId={testId}>
      {/* h-full fills the Card body (grow), allowing a child with mt-auto to anchor at the bottom so rows align across multiple SectionCards. */}
      <div className="flex h-full flex-col gap-4">{children}</div>
    </Card>
  );
}
