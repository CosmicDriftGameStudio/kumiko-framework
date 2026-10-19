// @runtime client
import { cn } from "@cosmicdrift/kumiko-renderer/web";
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
    <section className="flex flex-col border-b pb-1" data-testid={testId}>
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <div className="grow" />
        {action}
      </div>
      {children}
    </section>
  );
}

export function RailField({ children }: { readonly children: ReactNode }): ReactNode {
  return <div className="flex flex-col gap-3 px-3.5 py-2">{children}</div>;
}

const TRAILING_TONE = {
  ok: "text-status-ok",
  bad: "text-status-bad",
  muted: "text-muted-foreground",
} as const;

// The star rides on the last word so a wrapping label never leaves it alone on a line.
function RequiredLabel({ label }: { readonly label: string }): ReactNode {
  const lastSpace = label.lastIndexOf(" ");
  return (
    <>
      {label.slice(0, lastSpace + 1)}
      <span className="whitespace-nowrap">
        {label.slice(lastSpace + 1)}
        <span className="font-semibold text-status-bad">{" *"}</span>
      </span>
    </>
  );
}

export function RailRow({
  symbol,
  label,
  nameHint,
  required,
  trailing,
  trailingTone = "muted",
  action,
  bad,
  testId,
  onPress,
}: {
  readonly symbol?: string;
  readonly label: string;
  /** Technical name behind a translated label, shown as tooltip. */
  readonly nameHint?: string;
  readonly required?: boolean;
  readonly trailing?: ReactNode;
  readonly trailingTone?: keyof typeof TRAILING_TONE;
  readonly action?: ReactNode;
  readonly bad?: boolean;
  readonly testId?: string;
  readonly onPress?: () => void;
}): ReactNode {
  const content = (
    <>
      {symbol !== undefined && (
        <span className="inline-flex h-[18px] w-[22px] shrink-0 items-center justify-center rounded-sm bg-muted font-mono text-xs text-muted-foreground">
          {symbol}
        </span>
      )}
      <span
        className={cn(
          "min-w-0 grow break-words text-sm",
          trailing !== undefined && "min-w-min max-w-[65%] shrink-0",
          bad === true && "text-status-bad",
        )}
        title={nameHint !== undefined && nameHint !== label ? nameHint : undefined}
      >
        {required === true ? <RequiredLabel label={label} /> : label}
      </span>
      {trailing !== undefined && (
        <span
          className={cn(
            "min-w-0 truncate text-right text-xs",
            bad === true ? "text-status-bad" : TRAILING_TONE[trailingTone],
          )}
          title={typeof trailing === "string" ? trailing : undefined}
        >
          {trailing}
        </span>
      )}
    </>
  );
  const rowClass = "flex min-h-10 min-w-0 grow items-center gap-2 px-3.5 text-left";
  return (
    <div
      className={cn("flex items-center border-b", bad === true && "bg-status-bad-surface")}
      data-testid={testId}
      data-bad={bad === true ? "true" : undefined}
    >
      {onPress === undefined ? (
        <div className={rowClass}>{content}</div>
      ) : (
        <button
          type="button"
          onClick={onPress}
          className={cn(rowClass, "hover:bg-muted")}
          {...(testId !== undefined && { "data-testid": `${testId}-insert` })}
        >
          {content}
        </button>
      )}
      {action !== undefined && <div className="shrink-0 pr-2">{action}</div>}
    </div>
  );
}

export function RailHint({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className="px-3.5 pt-1 pb-2 text-xs text-muted-foreground">{children}</p>;
}
