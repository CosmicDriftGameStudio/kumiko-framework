import { FileQuestion, Lock } from "lucide-react";
import type { ReactNode } from "react";
import type { EmptyStateIcon, EmptyStateProps } from "../../index.ts";

const ICONS = {
  unavailable: Lock,
  "not-found": FileQuestion,
} satisfies Record<EmptyStateIcon, typeof Lock>;

export function DefaultEmptyState({
  icon,
  title,
  description,
  actions,
  testId,
}: EmptyStateProps): ReactNode {
  const Icon = ICONS[icon];
  return (
    <div
      data-testid={testId}
      className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"
    >
      <div className="rounded-full bg-muted p-3 text-muted-foreground">
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <h2
        data-testid={testId !== undefined ? `${testId}-title` : undefined}
        className="text-lg font-semibold"
      >
        {title}
      </h2>
      {description !== undefined && (
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">{description}</div>
      )}
      {actions !== undefined && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}
    </div>
  );
}
