import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

const CHIP_CLASS = "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors";

function chipTestId(testId: string | undefined, index: number): string | undefined {
  return testId !== undefined ? `${testId}-step-${index}` : undefined;
}

/** Wizard step overview — numbered chips with a connector line between
 *  them. With `onStepSelect`, done chips render as buttons for jumping back;
 *  current and upcoming chips never do. Three visual states, none conveyed by color alone:
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
  onStepSelect,
  narrowLayout = "label",
  orientation = "horizontal",
  heading,
  description,
  subtitles,
  upNext,
  testId,
  compactTestId,
}: {
  readonly steps: readonly string[];
  readonly currentIndex: number;
  readonly compactLabel: string;
  readonly onStepSelect?: (index: number) => void;
  readonly narrowLayout?: "label" | "steps";
  readonly orientation?: "horizontal" | "vertical";
  readonly heading?: string;
  readonly description?: string;
  readonly subtitles?: readonly (string | undefined)[];
  readonly upNext?: {
    readonly heading: string;
    readonly title: string;
    readonly subtitle?: string;
  };
  readonly testId?: string;
  readonly compactTestId?: string;
}): ReactNode {
  const t = useTranslation();
  if (orientation === "vertical") {
    return (
      <>
        <nav className="hidden w-[280px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-muted px-6 py-7 lg:flex">
          {heading !== undefined && (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-foreground">{heading}</span>
              {description !== undefined && (
                <span className="text-[13px] text-foreground-secondary">{description}</span>
              )}
            </div>
          )}
          <ol data-testid={testId} className="m-0 flex list-none flex-col gap-0.5 p-0">
            {steps.map((label, i) => {
              const isDone = i < currentIndex;
              const isCurrent = i === currentIndex;
              const rowClass = cn(
                "flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-sm",
                isCurrent && "bg-primary/10 font-semibold text-primary",
                isDone && "text-foreground",
                !isCurrent && !isDone && "text-foreground-secondary",
              );
              const content = (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-[22px] shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                      isCurrent && "border-primary bg-primary text-primary-foreground",
                      isDone && "border-status-ok-surface bg-status-ok-surface text-status-ok",
                      !isCurrent && !isDone && "border-input bg-card text-foreground-secondary",
                    )}
                  >
                    {isDone ? <Check className="size-3" /> : i + 1}
                  </span>
                  {isDone && <span className="sr-only">{t("kumiko.widget.step-bar.done")}</span>}
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{label}</span>
                    {subtitles?.[i] !== undefined && (
                      <span
                        data-testid={testId !== undefined ? `${testId}-subtitle-${i}` : undefined}
                        className="truncate text-xs font-normal text-foreground-secondary"
                      >
                        {subtitles[i]}
                      </span>
                    )}
                  </span>
                </>
              );
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: steps is a static, positional list — index is stable identity, no reorder/DnD.
                <li key={`${i}-${label}`}>
                  {isDone && onStepSelect !== undefined ? (
                    <button
                      type="button"
                      onClick={() => onStepSelect(i)}
                      data-testid={chipTestId(testId, i)}
                      className={cn(rowClass, "hover:bg-muted-foreground/10")}
                    >
                      {content}
                    </button>
                  ) : (
                    <span
                      aria-current={isCurrent ? "step" : undefined}
                      data-testid={chipTestId(testId, i)}
                      className={rowClass}
                    >
                      {content}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {upNext !== undefined && (
            <div
              data-testid={testId !== undefined ? `${testId}-up-next` : undefined}
              className="mt-2 flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2.5"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {upNext.heading}
              </span>
              <span className="text-sm font-medium text-foreground">{upNext.title}</span>
              {upNext.subtitle !== undefined && (
                <span className="text-xs text-foreground-secondary">{upNext.subtitle}</span>
              )}
            </div>
          )}
        </nav>
        <p
          data-testid={compactTestId}
          className="px-4 pt-3 text-sm text-muted-foreground lg:hidden"
        >
          {compactLabel}
        </p>
      </>
    );
  }
  return (
    <>
      <ol
        data-testid={testId}
        className={cn(
          "items-center gap-2",
          narrowLayout === "steps" ? "flex flex-wrap" : "hidden sm:flex sm:flex-wrap",
        )}
      >
        {steps.map((label, i) => {
          const isDone = i < currentIndex;
          const isCurrent = i === currentIndex;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps is a static, positional list — index is stable identity, no reorder/DnD.
            <li key={`${i}-${label}`} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true" className="h-px w-4 bg-border" />}
              {isDone && onStepSelect !== undefined ? (
                <button
                  type="button"
                  onClick={() => onStepSelect(i)}
                  data-testid={chipTestId(testId, i)}
                  className={cn(
                    CHIP_CLASS,
                    "text-primary max-sm:min-h-11 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  <Check aria-hidden="true" className="size-3.5" />
                  <span className="sr-only">{t("kumiko.widget.step-bar.done")}</span>
                  {label}
                </button>
              ) : (
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  data-testid={chipTestId(testId, i)}
                  className={cn(
                    CHIP_CLASS,
                    isCurrent && "bg-primary font-semibold text-primary-foreground",
                    isDone && "text-primary",
                    !isCurrent && !isDone && "text-muted-foreground",
                  )}
                >
                  {isDone ? (
                    <>
                      <Check aria-hidden="true" className="size-3.5" />
                      <span className="sr-only">{t("kumiko.widget.step-bar.done")}</span>
                    </>
                  ) : (
                    <span className="text-xs font-semibold">{i + 1}</span>
                  )}
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p
        data-testid={compactTestId}
        className={cn(
          "text-sm text-muted-foreground",
          narrowLayout === "steps" ? "hidden" : "sm:hidden",
        )}
      >
        {compactLabel}
      </p>
    </>
  );
}
