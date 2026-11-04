import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useContext } from "react";
import type { RecordSummaryProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { InsideScreenFormColumnContext } from "./metric.tsx";
import { useIsBelowSmViewport } from "./use-narrow-viewport.ts";

const SUMMARY_BORDER_CLASS: Readonly<Record<SelectOptionTone, string>> = {
  bad: "border-status-bad",
  warn: "border-status-warn",
  critical: "border-status-critical",
  ok: "border-status-ok",
  accent: "border-primary",
  neutral: "border-border-strong",
};

export function DefaultRecordSummary({
  text,
  narrowText,
  tone,
  testId,
}: RecordSummaryProps): ReactNode {
  const insideScreenFormColumn = useContext(InsideScreenFormColumnContext);
  const narrow = useIsBelowSmViewport();
  return (
    <div className={cn("shrink-0", !insideScreenFormColumn && "px-6 py-2")}>
      <p
        data-testid={testId}
        data-tone={tone}
        className={cn(
          "m-0 rounded-md border border-l-[3px] bg-card px-4 py-3 font-heading text-base leading-relaxed sm:text-[17px] text-foreground",
          tone === undefined ? "border-l-primary" : SUMMARY_BORDER_CLASS[tone],
        )}
      >
        {narrow && narrowText !== undefined ? narrowText : text}
      </p>
    </div>
  );
}
