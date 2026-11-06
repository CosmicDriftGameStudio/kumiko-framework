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
    <div className={cn("shrink-0", !insideScreenFormColumn && "px-6 py-2 max-sm:px-4")}>
      <p
        data-testid={testId}
        data-tone={tone}
        className={cn(
          "m-0 rounded-lg border border-l-[3px] bg-card px-3.5 py-2.5 sm:px-[18px] sm:py-3.5 font-heading text-[15px] leading-[1.5] sm:text-[17px] sm:leading-relaxed text-foreground",
          tone === undefined ? "border-l-primary" : SUMMARY_BORDER_CLASS[tone],
        )}
      >
        {narrow && narrowText !== undefined ? narrowText : text}
      </p>
    </div>
  );
}
