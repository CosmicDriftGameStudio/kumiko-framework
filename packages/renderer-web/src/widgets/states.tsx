import { dispatcherErrorText, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import type { DispatcherError } from "@cosmicdrift/kumiko-headless";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "../ui/skeleton";

/** Leerer-Zustand mit optionalem Icon + CTA — die dashed-Box-Optik der
 *  entityList-Empty-States, als Standalone-Widget für Custom-Screens. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  testId,
}: {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly testId?: string;
}): ReactNode {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center"
    >
      {icon !== undefined && <div className="text-muted-foreground">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      {description !== undefined && (
        <div className="text-sm text-muted-foreground">{description}</div>
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Lade-Zustand: Skeleton-Zeilen in Card-Optik. `rows` steuert die Höhe. */
export function LoadingState({
  rows = 3,
  className,
  testId,
}: {
  readonly rows?: number;
  readonly className?: string;
  readonly testId?: string;
}): ReactNode {
  const t = useTranslation();
  return (
    <output
      data-testid={testId}
      aria-label={t("kumiko.widget.loading")}
      className={cn("flex w-full flex-col gap-2", className)}
    >
      {Array.from({ length: rows }, (_, i) => (
        // Statische Skeleton-Liste — Index ist hier der stabile Key.
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </output>
  );
}

/** Fehler-Zustand auf Basis des Banner-Primitives, mit Retry-Button. */
export function ErrorState({
  error,
  onRetry,
  testId,
}: {
  readonly error: DispatcherError;
  readonly onRetry?: () => void;
  readonly testId?: string;
}): ReactNode {
  const { Banner, Button } = usePrimitives();
  const t = useTranslation();
  return (
    <Banner
      variant="error"
      testId={testId}
      actions={
        onRetry !== undefined ? (
          <Button variant="secondary" onClick={onRetry}>
            {t("kumiko.actions.reload")}
          </Button>
        ) : undefined
      }
    >
      {t("kumiko.widget.error.title")} {dispatcherErrorText(error, t)}
    </Banner>
  );
}
