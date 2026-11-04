import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useContext, useState } from "react";
import type { RecordStepsProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { InsideScreenFormColumnContext } from "./metric.tsx";
import { ReasonBox, ReasonInfoButton } from "./reason-box.tsx";

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
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-start gap-2">
            <span className="font-medium text-foreground">{item.title}</span>
            {item.reason !== undefined && (
              <ReasonInfoButton
                label={reasonLabel}
                open={reasonOpen}
                onToggle={() => setReasonOpen((open) => !open)}
              />
            )}
          </div>
          {item.detail !== undefined && (
            <small className="text-xs text-muted-foreground">{item.detail}</small>
          )}
        </div>
        {item.actions !== undefined && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:basis-full max-sm:justify-start">
            {item.actions}
          </div>
        )}
      </div>
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
  items,
  testId,
}: RecordStepsProps): ReactNode {
  const insideScreenFormColumn = useContext(InsideScreenFormColumnContext);
  return (
    <section
      data-testid={testId}
      className={cn("shrink-0", !insideScreenFormColumn && "px-6 py-2")}
    >
      <div className="rounded-md border bg-card">
        <header className="flex flex-wrap items-baseline gap-x-3 border-b px-4 py-3">
          <h3 className="m-0 text-sm font-semibold text-foreground">{title}</h3>
          {subtitle !== undefined && (
            <span className="text-[13px] text-muted-foreground">{subtitle}</span>
          )}
        </header>
        {items.length === 0 ? (
          <p className="m-0 px-4 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="m-0 list-none divide-y p-0">
            {items.map((item) => (
              <StepRow key={item.id} item={item} reasonLabel={reasonLabel} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
