import { type ReactNode, useContext, useId, useState } from "react";
import type { RecordStepsProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { InsideScreenFormColumnContext } from "./metric.tsx";
import { ReasonBox, ReasonInfoButton } from "./reason-box.tsx";
import { useIsBelowSmViewport } from "./use-narrow-viewport.ts";

type StepItem = RecordStepsProps["items"][number];

function StepTitle({ item }: { item: StepItem }): ReactNode {
  const narrow = useIsBelowSmViewport();
  return narrow ? (item.narrowTitle ?? item.title) : item.title;
}

function StepDetail({ item }: { item: StepItem }): ReactNode {
  const narrow = useIsBelowSmViewport();
  const detail = narrow ? (item.narrowDetail ?? item.detail) : item.detail;
  if (detail === undefined) return null;
  return <small className="block text-xs text-muted-foreground">{detail}</small>;
}

function StepRow({
  item,
  reasonLabel,
  moreActionsLabel,
}: {
  item: StepItem;
  reasonLabel: string;
  moreActionsLabel: string | undefined;
}): ReactNode {
  const [reasonOpen, setReasonOpen] = useState(item.reasonOpen === true);
  const reasonBoxId = useId();
  return (
    <li
      data-testid={`record-step-${item.id}`}
      data-tone={item.tone}
      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] content-center gap-x-3 gap-y-1 px-4 py-2.5"
    >
      <div className="col-start-1 row-start-1 flex min-w-0 items-start gap-2">
        <span className="font-medium text-foreground max-sm:text-[13.5px]" data-slot="step-what">
          <StepTitle item={item} />
        </span>
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
      <div className="col-start-1 row-start-2 min-w-0 sm:col-span-1">
        <StepDetail item={item} />
      </div>
      {item.actions !== undefined && (
        <div className="flex shrink-0 items-center gap-3 max-sm:col-span-2 max-sm:row-start-3 max-sm:mt-1 [&_button]:h-9 [&_button_svg]:hidden max-sm:[&>*]:w-full max-sm:[&_button]:w-full sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:self-center">
          {item.actions}
        </div>
      )}
      {item.moreActions !== undefined && (
        <div
          data-testid={`record-step-${item.id}-more-actions`}
          className="col-span-2 row-start-4 mt-1 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-row pt-2.5 text-[12.5px]"
        >
          {moreActionsLabel !== undefined && (
            <span
              className="text-muted-foreground max-sm:w-full"
              data-testid={`record-step-${item.id}-more-actions-label`}
            >
              {moreActionsLabel}
            </span>
          )}
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] [&_button]:h-9 [&_button]:rounded-md [&_button]:border [&_button]:border-border-strong [&_button]:bg-card [&_button]:px-3 [&_button]:text-[12.5px] [&_button]:font-medium [&_button]:text-foreground [&_button_svg]:text-primary">
            {item.moreActions}
          </div>
        </div>
      )}
      {item.reason !== undefined && reasonOpen && (
        <div className="col-span-2 row-start-5 max-sm:hidden">
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

function StepsHeader({ title, subtitle }: Pick<RecordStepsProps, "title" | "subtitle">): ReactNode {
  return (
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-2.5">
      <h3 className="m-0 text-[11.5px] font-normal text-muted-foreground">{title}</h3>
      {subtitle !== undefined && (
        <span className="text-[13px] text-muted-foreground max-sm:hidden">{subtitle}</span>
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
      className="w-full border-t border-border-row px-4 py-3 text-left text-sm font-medium text-primary hover:underline max-sm:py-[9px] max-sm:text-xs max-sm:font-normal"
      onClick={onToggle}
    >
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
  moreActionsLabel,
  items,
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
      className={cn("shrink-0", !insideScreenFormColumn && "px-6 py-2 max-sm:px-4")}
    >
      <div className="rounded-[9px] border border-border bg-card">
        <StepsHeader title={title} subtitle={subtitle} />
        {items.length === 0 ? (
          <p className="m-0 px-4 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-border-row p-0">
            {visible.map((item) => (
              <StepRow
                key={item.id}
                item={item}
                reasonLabel={reasonLabel}
                moreActionsLabel={moreActionsLabel}
              />
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
