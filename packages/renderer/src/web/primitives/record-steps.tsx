import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useContext, useId, useState } from "react";
import type { RecordStepsProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { InsideScreenFormColumnContext } from "./metric.tsx";
import { ReasonBox, ReasonInfoButton } from "./reason-box.tsx";
import { useIsBelowSmViewport } from "./use-narrow-viewport.ts";

const STEP_STRIPE_CLASS: Readonly<Record<SelectOptionTone, string>> = {
  bad: "bg-status-bad",
  warn: "bg-status-warn",
  critical: "bg-status-critical",
  ok: "bg-status-ok",
  accent: "bg-primary",
  neutral: "bg-border-strong",
};

type StepItem = RecordStepsProps["items"][number];

function StepDetail({ item }: { item: StepItem }): ReactNode {
  const narrow = useIsBelowSmViewport();
  const detail = narrow ? (item.narrowDetail ?? item.detail) : item.detail;
  if (detail === undefined) return null;
  return <small className="block text-xs text-muted-foreground">{detail}</small>;
}

function StepRow({ item, reasonLabel }: { item: StepItem; reasonLabel: string }): ReactNode {
  const [reasonOpen, setReasonOpen] = useState(item.reasonOpen === true);
  const reasonBoxId = useId();
  return (
    <li
      data-testid={`record-step-${item.id}`}
      data-tone={item.tone}
      className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 py-3 pl-5 pr-4 max-sm:py-1.5 max-sm:pl-3.5 max-sm:pr-0"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-2 left-0 w-1 rounded-full max-sm:inset-y-0 max-sm:w-[3px]",
          STEP_STRIPE_CLASS[item.tone ?? "neutral"],
        )}
      />
      <div className="col-start-1 row-start-1 flex min-w-0 items-start gap-2">
        <span className="font-medium text-foreground max-sm:text-sm">{item.title}</span>
        {item.reason !== undefined && (
          <span className="flex max-sm:hidden">
            <ReasonInfoButton
              label={reasonLabel}
              open={reasonOpen}
              controls={reasonBoxId}
              onToggle={() => setReasonOpen((open) => !open)}
            />
          </span>
        )}
      </div>
      <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-3 max-sm:row-span-2 max-sm:self-center max-sm:[&_button]:h-8 max-sm:[&_button]:text-[13px]">
        {item.moreActions !== undefined && <div className="max-sm:hidden">{item.moreActions}</div>}
        {item.actions}
      </div>
      <div className="col-start-1 row-start-2 min-w-0 sm:col-span-2">
        <StepDetail item={item} />
      </div>
      {item.reason !== undefined && reasonOpen && (
        <div className="col-span-2 row-start-3 max-sm:hidden">
          <ReasonBox
            id={reasonBoxId}
            testId={`record-step-${item.id}-reason`}
            {...(item.reasonTitle !== undefined && { title: item.reasonTitle })}
          >
            {item.reason}
          </ReasonBox>
        </div>
      )}
    </li>
  );
}

function StepsHeader({
  title,
  subtitle,
  count,
  testId,
}: Pick<RecordStepsProps, "title" | "subtitle" | "count" | "testId">): ReactNode {
  return (
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 sm:border-b max-sm:px-0 max-sm:pt-1">
      <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
      {subtitle !== undefined && (
        <span className="text-[13px] text-muted-foreground max-sm:hidden">{subtitle}</span>
      )}
      {count !== undefined && (
        <span
          data-testid={`${testId ?? "record-steps"}-count`}
          className="ml-auto text-xs text-muted-foreground sm:hidden"
        >
          {count}
        </span>
      )}
    </header>
  );
}

function StepsMoreToggle({
  testId,
  expanded,
  label,
  onToggle,
}: {
  testId: string | undefined;
  expanded: boolean;
  label: string;
  onToggle: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      data-testid={`${testId ?? "record-steps"}-toggle`}
      aria-expanded={expanded}
      className="relative w-full border-t px-4 py-3 text-left text-sm font-medium text-primary hover:underline max-sm:mt-2.5 max-sm:border-t-0 max-sm:py-1 max-sm:pl-3.5 max-sm:pr-0 max-sm:text-xs max-sm:font-normal max-sm:text-muted-foreground max-sm:no-underline"
      onClick={onToggle}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[3px] rounded-full bg-border sm:hidden"
      />
      {label}
    </button>
  );
}

export function DefaultRecordSteps({
  title,
  subtitle,
  emptyLabel,
  reasonLabel,
  narrowLimit,
  moreLabel,
  lessLabel,
  items,
  count,
  testId,
}: RecordStepsProps): ReactNode {
  const insideScreenFormColumn = useContext(InsideScreenFormColumnContext);
  const narrow = useIsBelowSmViewport();
  const [expanded, setExpanded] = useState(false);
  const limited = narrow && narrowLimit !== undefined && items.length > narrowLimit;
  const visible = limited && !expanded ? items.slice(0, narrowLimit) : items;
  const toggleLabel =
    moreLabel === undefined || lessLabel === undefined
      ? undefined
      : expanded
        ? lessLabel
        : moreLabel(items.length - visible.length);
  return (
    <section
      data-testid={testId}
      className={cn("shrink-0", !insideScreenFormColumn && "px-6 py-2")}
    >
      <div className="sm:rounded-md sm:border sm:bg-card">
        <StepsHeader title={title} subtitle={subtitle} count={count} testId={testId} />
        {items.length === 0 ? (
          <p className="m-0 px-4 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0 max-sm:gap-2.5 sm:divide-y">
            {visible.map((item) => (
              <StepRow key={item.id} item={item} reasonLabel={reasonLabel} />
            ))}
          </ul>
        )}
        {limited && toggleLabel !== undefined && (
          <StepsMoreToggle
            testId={testId}
            expanded={expanded}
            label={toggleLabel}
            onToggle={() => setExpanded((open) => !open)}
          />
        )}
      </div>
    </section>
  );
}
