import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** Wizard step overview — numbered chips with a connector line between
 *  them, not clickable. Three visual states, none conveyed by color alone:
 *  done (checkmark replaces the number, `aria-current` absent, a sr-only
 *  label says so since the number itself is gone), current (`aria-current
 *  ="step"`, own background), upcoming (dimmed, number visible). Below
 *  `sm` the chip row hides in favor of `compactLabel` (seven step names
 *  don't fit on a phone) — both live in the DOM, Tailwind's
 *  `hidden`/`sm:hidden` pair picks the visible one per viewport (same
 *  pattern as embedded-list-input.tsx's desktop/mobile split). */
export function StepBar({
  steps,
  currentIndex,
  compactLabel,
  testId,
  compactTestId,
}: {
  readonly steps: readonly string[];
  readonly currentIndex: number;
  readonly compactLabel: string;
  readonly testId?: string;
  readonly compactTestId?: string;
}): ReactNode {
  const t = useTranslation();
  return (
    <>
      <ol data-testid={testId} className="hidden items-center gap-2 sm:flex sm:flex-wrap">
        {steps.map((label, i) => {
          const isDone = i < currentIndex;
          const isCurrent = i === currentIndex;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps is a static, positional list — index is stable identity, no reorder/DnD.
            <li key={`${i}-${label}`} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true" className="h-px w-4 bg-border" />}
              <span
                aria-current={isCurrent ? "step" : undefined}
                data-testid={testId !== undefined ? `${testId}-step-${i}` : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors",
                  isCurrent && "bg-primary font-semibold text-primary-foreground",
                  isDone && "text-primary",
                  !isCurrent && !isDone && "text-muted-foreground",
                )}
              >
                {isDone ? (
                  <>
                    <Check aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">{t("kumiko.widget.stepBar.done")}</span>
                  </>
                ) : (
                  <span className="text-xs font-semibold">{i + 1}</span>
                )}
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      <p data-testid={compactTestId} className="text-sm text-muted-foreground sm:hidden">
        {compactLabel}
      </p>
    </>
  );
}
