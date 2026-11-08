import type { ReactNode } from "react";
import type { StepListProps } from "../../index.ts";
import { statusToneForOptionTone } from "../../status-tone.ts";
import { StatusBadge } from "../widgets/status-badge.tsx";

export function DefaultStepList({ items, testId }: StepListProps): ReactNode {
  return (
    <ol data-testid={testId} className="m-0 flex list-none flex-col p-0">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <li
            key={item.id}
            data-testid={testId !== undefined ? `${testId}-step-${item.id}` : undefined}
            className="flex gap-3"
          >
            <div className="flex flex-col items-center">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {index + 1}
              </span>
              {!isLast && <span className="my-1 w-px flex-1 bg-border" />}
            </div>
            <div className={isLast ? "flex flex-col gap-1" : "flex flex-col gap-1 pb-5"}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{item.title}</span>
                {item.status !== undefined && (
                  <StatusBadge
                    tone={
                      (item.statusTone !== undefined
                        ? statusToneForOptionTone(item.statusTone)
                        : undefined) ?? "muted"
                    }
                  >
                    {item.status}
                  </StatusBadge>
                )}
              </div>
              {item.description !== undefined && (
                <span className="text-sm text-muted-foreground">{item.description}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
