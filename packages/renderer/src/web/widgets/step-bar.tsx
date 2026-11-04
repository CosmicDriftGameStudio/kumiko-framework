import { Check, ChevronDown } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";

const CHIP_CLASS = "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors";

function chipTestId(testId: string | undefined, index: number): string | undefined {
  return testId !== undefined ? `${testId}-step-${index}` : undefined;
}

type StepState = { isCurrent: boolean; isDone: boolean; isSelectable: boolean };

function StepRailRow({
  index,
  label,
  subtitle,
  subtitleTestId,
  rowTestId,
  state: { isCurrent, isDone, isSelectable },
  onSelect,
  doneLabel,
  minHeightClass = "min-h-9",
}: {
  readonly index: number;
  readonly label: string;
  readonly subtitle: string | undefined;
  readonly subtitleTestId: string | undefined;
  readonly rowTestId: string | undefined;
  readonly state: StepState;
  readonly onSelect: ((index: number) => void) | undefined;
  readonly doneLabel: string;
  readonly minHeightClass?: string;
}): ReactNode {
  const rowClass = cn(
    "flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-sm",
    minHeightClass,
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
        {isDone ? <Check className="size-3" /> : index + 1}
      </span>
      {isDone && <span className="sr-only">{doneLabel}</span>}
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {subtitle !== undefined && (
          <span
            data-testid={subtitleTestId}
            className="text-xs font-normal text-foreground-secondary"
          >
            {subtitle}
          </span>
        )}
      </span>
    </>
  );
  return isSelectable ? (
    <button
      type="button"
      onClick={() => onSelect?.(index)}
      data-testid={rowTestId}
      className={cn(rowClass, "hover:bg-muted-foreground/10")}
    >
      {content}
    </button>
  ) : (
    <span
      aria-current={isCurrent ? "step" : undefined}
      data-testid={rowTestId}
      className={rowClass}
    >
      {content}
    </span>
  );
}

function RailHeading({
  heading,
  description,
}: {
  readonly heading: string;
  readonly description: string | undefined;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-foreground">{heading}</span>
      {description !== undefined && (
        <span className="text-[13px] text-foreground-secondary">{description}</span>
      )}
    </div>
  );
}

function UpNextBox({
  upNext,
  testId,
}: {
  readonly upNext: { readonly heading: string; readonly title: string; readonly subtitle?: string };
  readonly testId: string | undefined;
}): ReactNode {
  return (
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
  );
}

// `selectable` is false without an onStepSelect handler, else the selectableSteps mode.
function stepStateAt(
  index: number,
  {
    currentIndex,
    doneSteps,
    selectable,
  }: {
    readonly currentIndex: number;
    readonly doneSteps: readonly boolean[] | undefined;
    readonly selectable: false | "done" | "all";
  },
): StepState {
  const isCurrent = index === currentIndex;
  const isDone =
    !isCurrent && (doneSteps !== undefined ? doneSteps[index] === true : index < currentIndex);
  const isSelectable = selectable !== false && !isCurrent && (selectable === "all" || isDone);
  return { isCurrent, isDone, isSelectable };
}

function ChainMarker({ state }: { readonly state: StepState }): ReactNode {
  const { isCurrent, isDone } = state;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "z-10 mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 bg-card",
        isDone && "border-status-ok bg-status-ok text-primary-foreground",
        isCurrent && "border-status-warn",
        !isDone && !isCurrent && "border-input",
      )}
    >
      {isDone && <Check className="size-3" strokeWidth={3} />}
      {isCurrent && <span className="size-2 rounded-full bg-status-warn" />}
    </span>
  );
}

// Chain look: a vertical connector joins the markers; done is a filled check, current a ring with
// a dot (title in the warn tone), open an empty ring. No numbers, no box around the current step.
function StackedStageList({
  steps,
  subtitles,
  stepState,
  onSelect,
  doneLabel,
  testId,
}: {
  readonly steps: readonly string[];
  readonly subtitles: readonly (string | undefined)[] | undefined;
  readonly stepState: (index: number) => StepState;
  readonly onSelect: ((index: number) => void) | undefined;
  readonly doneLabel: string;
  readonly testId: string | undefined;
}): ReactNode {
  const keyed = steps.map((label, index) => ({ label, index, key: `${index}-${label}` }));
  return (
    <ol data-testid={testId} className="m-0 flex list-none flex-col p-0">
      {keyed.map(({ label, index, key }) => {
        const state = stepState(index);
        const subtitle = subtitles?.[index];
        const body = (
          <>
            <span className="relative flex flex-col items-center self-stretch">
              <ChainMarker state={state} />
              {index < keyed.length - 1 && (
                // From the marker's bottom edge to the next marker's top edge (its mt-0.5 gap included).
                <span
                  aria-hidden="true"
                  data-kumiko-layout="step-chain-connector"
                  className="absolute -bottom-0.5 left-1/2 top-5 w-px -translate-x-1/2 bg-input"
                />
              )}
            </span>
            {state.isDone && <span className="sr-only">{doneLabel}</span>}
            <span className="flex min-w-0 flex-col pb-3">
              <span
                className={cn(
                  "text-sm",
                  state.isCurrent ? "font-semibold text-status-warn" : "text-foreground",
                  !state.isCurrent && !state.isDone && "text-foreground-secondary",
                )}
              >
                {label}
              </span>
              {subtitle !== undefined && (
                <span
                  data-testid={testId !== undefined ? `${testId}-subtitle-${index}` : undefined}
                  className="text-xs text-foreground-secondary"
                >
                  {subtitle}
                </span>
              )}
            </span>
          </>
        );
        return (
          <li key={key}>
            {state.isSelectable ? (
              <button
                type="button"
                onClick={() => onSelect?.(index)}
                data-testid={chipTestId(testId, index)}
                className="flex w-full items-stretch gap-2.5 text-left hover:opacity-80"
              >
                {body}
              </button>
            ) : (
              <span
                aria-current={state.isCurrent ? "step" : undefined}
                data-testid={chipTestId(testId, index)}
                className="flex w-full items-stretch gap-2.5"
              >
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CompactStepPicker({
  steps,
  compactLabel,
  subtitles,
  stepState,
  onStepSelect,
  compactTestId,
  doneLabel,
}: {
  readonly steps: readonly string[];
  readonly compactLabel: string;
  readonly subtitles: readonly (string | undefined)[] | undefined;
  readonly stepState: (index: number) => StepState;
  readonly onStepSelect: (index: number) => void;
  readonly compactTestId: string | undefined;
  readonly doneLabel: string;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: wrapper only catches Escape bubbling from the toggle and list buttons; it is not itself interactive.
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          toggleRef.current?.focus();
        }
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-testid={compactTestId}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-card px-3 text-left text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {compactLabel}
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <ol
          id={listId}
          className="m-0 mt-1 flex list-none flex-col gap-0.5 rounded-md border border-border bg-card p-1"
        >
          {steps.map((label, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps is a static, positional list — index is stable identity, no reorder/DnD.
            <li key={`${i}-${label}`}>
              <StepRailRow
                index={i}
                label={label}
                subtitle={subtitles?.[i]}
                subtitleTestId={undefined}
                rowTestId={chipTestId(compactTestId, i)}
                state={stepState(i)}
                onSelect={(index) => {
                  setOpen(false);
                  onStepSelect(index);
                }}
                doneLabel={doneLabel}
                minHeightClass="min-h-11"
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Wizard step overview — numbered chips with a connector line between
 *  them. With `onStepSelect`, done chips render as buttons for jumping back
 *  (every non-current chip with `selectableSteps="all"`); the current chip
 *  never does. `doneSteps` overrides the position-based done state. With
 *  `onStepSelect` and `selectableSteps="all"` the narrow-viewport label becomes
 *  a dropdown listing every step (same rows as the rail), so phones can jump
 *  too. Three visual states, none conveyed by color alone:
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
  doneSteps,
  selectableSteps = "done",
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
  readonly doneSteps?: readonly boolean[];
  readonly selectableSteps?: "done" | "all";
  readonly narrowLayout?: "label" | "steps";
  readonly orientation?: "horizontal" | "vertical" | "stacked";
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
  const stepState = (i: number): StepState =>
    stepStateAt(i, {
      currentIndex,
      doneSteps,
      selectable: onStepSelect !== undefined && selectableSteps,
    });
  const compactPicker = onStepSelect !== undefined && selectableSteps === "all";
  const pickerElement = compactPicker ? (
    <CompactStepPicker
      steps={steps}
      compactLabel={compactLabel}
      subtitles={subtitles}
      stepState={stepState}
      onStepSelect={onStepSelect}
      compactTestId={compactTestId}
      doneLabel={t("kumiko.widget.step-bar.done")}
    />
  ) : null;
  if (orientation === "stacked") {
    return (
      <StackedStageList
        steps={steps}
        subtitles={subtitles}
        stepState={stepState}
        onSelect={onStepSelect}
        doneLabel={t("kumiko.widget.step-bar.done")}
        testId={testId}
      />
    );
  }
  if (orientation === "vertical") {
    return (
      <>
        <nav className="hidden w-[280px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-muted px-6 py-7 lg:flex">
          {heading !== undefined && <RailHeading heading={heading} description={description} />}
          <ol data-testid={testId} className="m-0 flex list-none flex-col gap-0.5 p-0">
            {steps.map((label, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: steps is a static, positional list — index is stable identity, no reorder/DnD.
              <li key={`${i}-${label}`}>
                <StepRailRow
                  index={i}
                  label={label}
                  subtitle={subtitles?.[i]}
                  subtitleTestId={testId !== undefined ? `${testId}-subtitle-${i}` : undefined}
                  rowTestId={chipTestId(testId, i)}
                  state={stepState(i)}
                  onSelect={onStepSelect}
                  doneLabel={t("kumiko.widget.step-bar.done")}
                />
              </li>
            ))}
          </ol>
          {upNext !== undefined && <UpNextBox upNext={upNext} testId={testId} />}
        </nav>
        {compactPicker ? (
          <div className="px-4 pt-3 lg:hidden">{pickerElement}</div>
        ) : (
          <p
            data-testid={compactTestId}
            className="px-4 pt-3 text-sm text-muted-foreground lg:hidden"
          >
            {compactLabel}
          </p>
        )}
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
          const { isCurrent, isDone, isSelectable } = stepState(i);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: steps is a static, positional list — index is stable identity, no reorder/DnD.
            <li key={`${i}-${label}`} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true" className="h-px w-4 bg-border" />}
              {isSelectable ? (
                <button
                  type="button"
                  onClick={() => onStepSelect?.(i)}
                  data-testid={chipTestId(testId, i)}
                  className={cn(
                    CHIP_CLASS,
                    isDone ? "text-primary" : "text-muted-foreground",
                    "max-sm:min-h-11 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
      {compactPicker ? (
        <div className={narrowLayout === "steps" ? "hidden" : "sm:hidden"}>{pickerElement}</div>
      ) : (
        <p
          data-testid={compactTestId}
          className={cn(
            "text-sm text-muted-foreground",
            narrowLayout === "steps" ? "hidden" : "sm:hidden",
          )}
        >
          {compactLabel}
        </p>
      )}
    </>
  );
}
