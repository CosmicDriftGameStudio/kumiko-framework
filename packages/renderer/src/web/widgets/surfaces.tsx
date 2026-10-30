import type { ReactNode } from "react";

export const SENDER_FRAME_CLASS = "rounded-md border border-sender-frame-border bg-sender-frame";

/** The white sheet alone, for a frame that holds several sheets (PDF pages, thumbnails). */
export function SenderSheet({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}): ReactNode {
  return (
    <div
      data-testid={testId}
      className="rounded-sheet bg-sender-sheet px-6 py-5 text-foreground shadow-sheet"
    >
      {children}
    </div>
  );
}

/** Sand frame with one white sheet inside, for content that mimics a letter or mail. */
export function SenderFrame({
  children,
  label,
  testId,
}: {
  readonly children: ReactNode;
  readonly label?: string;
  readonly testId?: string;
}): ReactNode {
  return (
    <section aria-label={label} data-testid={testId} className={`${SENDER_FRAME_CLASS} p-4`}>
      <SenderSheet>{children}</SenderSheet>
    </section>
  );
}

/** Light blue area that marks content as AI-generated. */
export function AiSurface({
  children,
  title,
  label,
  testId,
  as: Element = "section",
}: {
  readonly children: ReactNode;
  readonly title?: string;
  readonly label?: string;
  readonly testId?: string;
  readonly as?: "section" | "aside" | "div";
}): ReactNode {
  return (
    <Element
      aria-label={label}
      data-testid={testId}
      className="flex flex-col gap-2 rounded-md bg-ai-surface px-3.5 py-3"
    >
      {title !== undefined && (
        <h3 className="m-0 text-xs font-semibold text-foreground-secondary">{title}</h3>
      )}
      {children}
    </Element>
  );
}
