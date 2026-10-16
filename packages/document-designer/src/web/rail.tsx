// @runtime client
import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { cn } from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

export function RailSection({
  title,
  action,
  testId,
  children,
}: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly testId?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <section className="flex flex-col gap-1" data-testid={testId}>
      <div className="flex items-center gap-2 pt-3 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <div className="grow" />
        {action}
      </div>
      {children}
    </section>
  );
}

export function RailRow({
  symbol,
  label,
  trailing,
  bad,
  testId,
  onPress,
}: {
  readonly symbol?: string;
  readonly label: string;
  readonly trailing?: ReactNode;
  readonly bad?: boolean;
  readonly testId?: string;
  readonly onPress?: () => void;
}): ReactNode {
  const { Button } = usePrimitives();
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1",
        bad === true && "bg-status-bad-surface text-status-bad",
      )}
      data-testid={testId}
      data-bad={bad === true ? "true" : undefined}
    >
      {symbol !== undefined && (
        <span className="w-4 shrink-0 text-center text-xs text-muted-foreground">{symbol}</span>
      )}
      <span className="min-w-0 grow truncate text-sm">
        {onPress === undefined ? (
          label
        ) : (
          <Button
            variant="link"
            onClick={onPress}
            {...(testId !== undefined && { testId: `${testId}-insert` })}
          >
            {label}
          </Button>
        )}
      </span>
      {trailing !== undefined && (
        <span
          className="min-w-0 max-w-[60%] truncate text-right text-xs text-muted-foreground"
          title={typeof trailing === "string" ? trailing : undefined}
        >
          {trailing}
        </span>
      )}
    </div>
  );
}

export function RailHint({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className="px-2 pt-1 text-xs text-muted-foreground">{children}</p>;
}
