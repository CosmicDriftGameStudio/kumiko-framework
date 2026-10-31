import type { ReactNode } from "react";
import type { InputEndAction } from "../../primitives.tsx";
import { cn } from "../lib/cn.ts";

export type AiTextEndAction = InputEndAction;

/** Keeps typed text clear of the end action; a text button needs more room than an icon. */
export function endActionPaddingClass(action: AiTextEndAction | undefined): string | undefined {
  if (action === undefined) return undefined;
  return action.label !== undefined ? "pr-28" : "pr-11";
}

/** Icon button inside the right edge of the input, e.g. a microphone. */
export function AiTextEndActionButton({
  action,
  multiline,
  disabled,
  testId,
}: {
  readonly action: AiTextEndAction;
  readonly multiline: boolean;
  readonly disabled: boolean;
  readonly testId: string | undefined;
}): ReactNode {
  if (action.label !== undefined) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={action.onClick}
        data-testid={testId !== undefined ? `${testId}-end-action` : undefined}
        className={cn(
          "absolute right-1 z-10 flex h-7 items-center rounded-md border-0 bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
          multiline ? "top-1" : "top-1/2 -translate-y-1/2",
        )}
      >
        {action.label}
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label={action.ariaLabel}
      aria-pressed={action.pressed}
      disabled={disabled}
      onClick={action.onClick}
      data-testid={testId !== undefined ? `${testId}-end-action` : undefined}
      className={cn(
        "absolute right-1.5 z-10 flex size-8 items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 aria-pressed:bg-accent aria-pressed:text-foreground [&>svg]:size-4",
        multiline ? "top-1.5" : "top-1/2 -translate-y-1/2",
      )}
    >
      {action.icon}
    </button>
  );
}
