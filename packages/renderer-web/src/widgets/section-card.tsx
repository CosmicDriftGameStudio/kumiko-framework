import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";

/** Sektion mit Titel + optionalem Action-Slot (Range-Umschalter, Filter) —
 *  ersetzt die wiederholten `<section className={CARD}>…<h2>`-Blöcke in
 *  Custom-Screens. Dünner Wrapper über das Card-Primitive. */
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
      {/* h-full füllt den Card-Body (grow) → ein Kind mit mt-auto kann sich unten
          ankern, damit Card-Reihen über mehrere SectionCards fluchten. */}
      <div className="flex h-full flex-col gap-4">{children}</div>
    </Card>
  );
}
