import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useContext, useState } from "react";
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

function StepRow({ item, reasonLabel }: { item: StepItem; reasonLabel: string }): ReactNode {
  const [reasonOpen, setReasonOpen] = useState(false);
  return (
    <li
      data-testid={`record-step-${item.id}`}
      data-tone={item.tone}
      className="relative flex flex-col gap-1 py-3 pl-5 pr-4"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-2 left-0 w-1 rounded-full",
          STEP_STRIPE_CLASS[item.tone ?? "neutral"],
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="font-medium text-foreground">{item.title}</span>
          {item.reason !== undefined && (
            <ReasonInfoButton
              label={reasonLabel}
              open={reasonOpen}
              onToggle={() => setReasonOpen((open) => !open)}
            />
          )}
        </div>
        {item.actions !== undefined && <div className="shrink-0">{item.actions}</div>}
      </div>
      {item.detail !== undefined && (
        <small className="text-xs text-muted-foreground">{item.detail}</small>
      )}
      {item.moreActions !== undefined && <div className="pt-0.5">{item.moreActions}</div>}
      {item.reason !== undefined && reasonOpen && (
        <ReasonBox testId={`record-step-${item.id}-reason`}>{item.reason}</ReasonBox>
      )}
    </li>
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
  const hiddenCount = items.length - visible.length;
  return (
    <section
      data-testid={testId}
      className={cn("shrink-0", !insideScreenFormColumn && "px-6 py-2")}
    >
      <div className="rounded-md border bg-card">
        <header className="flex items-baseline gap-x-3 border-b px-4 py-3">
          <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
          {subtitle !== undefined && (
            <span className="text-[13px] text-muted-foreground">{subtitle}</span>
          )}
          {count !== undefined && (
            <span
              data-testid={`${testId ?? "record-steps"}-count`}
              className="ml-auto text-xs text-muted-foreground"
            >
              {count}
            </span>
          )}
        </header>
        {items.length === 0 ? (
          <p className="m-0 px-4 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="m-0 list-none divide-y p-0">
            {visible.map((item) => (
              <StepRow key={item.id} item={item} reasonLabel={reasonLabel} />
            ))}
          </ul>
        )}
        {limited && moreLabel !== undefined && lessLabel !== undefined && (
          <button
            type="button"
            data-testid={`${testId ?? "record-steps"}-toggle`}
            aria-expanded={expanded}
            className="w-full border-t px-4 py-3 text-left text-sm font-medium text-primary hover:underline"
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? lessLabel : moreLabel(hiddenCount)}
          </button>
        )}
      </div>
    </section>
  );
}
