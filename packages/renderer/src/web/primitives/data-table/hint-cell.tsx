import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import type { ListColumnHintViewModel } from "../../../headless/index.ts";
import { isSelectOptionTone } from "../../../status-tone.ts";
import { cn } from "../../lib/cn.ts";

const HINT_TONE_TEXT_CLASS: Readonly<Record<SelectOptionTone, string>> = {
  bad: "text-status-bad",
  warn: "text-status-warn",
  critical: "text-status-critical",
  ok: "text-status-ok",
  accent: "text-primary",
  neutral: "",
};

function nonEmptyText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function ReasonToggle({
  label,
  reason,
}: {
  readonly label: string;
  readonly reason: string;
}): ReactNode {
  const [reasonOpen, setReasonOpen] = useState(false);
  return (
    <>
      {/* The row itself is clickable; the toggle must not open it. */}
      <button
        type="button"
        aria-expanded={reasonOpen}
        data-hint-reason-toggle="true"
        className="w-fit text-xs text-muted-foreground underline"
        onClick={(event) => {
          event.stopPropagation();
          setReasonOpen((open) => !open);
        }}
      >
        {label}
      </button>
      {reasonOpen && (
        <small data-hint-reason="true" className="text-xs text-muted-foreground">
          {reason}
        </small>
      )}
    </>
  );
}

/** "To do" cell: an emphasized sentence in the row tone with an optional muted second line. */
export function HintCell({
  value,
  row,
  hint,
  insideRowOpener = false,
}: {
  readonly value: unknown;
  readonly row: Readonly<Record<string, unknown>>;
  readonly hint: ListColumnHintViewModel;
  // A row-open button already wraps the cell and must not contain another
  // button, so the reason is shown open instead of behind a toggle.
  readonly insideRowOpener?: boolean;
}): ReactNode {
  const sentence = nonEmptyText(value);
  if (sentence === undefined) {
    return (
      <span data-hint-empty="true" className="text-muted-foreground">
        {hint.emptyLabel}
      </span>
    );
  }
  const toneValue = hint.toneField === undefined ? undefined : row[hint.toneField];
  const tone = isSelectOptionTone(toneValue) ? toneValue : undefined;
  const detail = hint.detailField === undefined ? undefined : nonEmptyText(row[hint.detailField]);
  const reason = hint.reasonField === undefined ? undefined : nonEmptyText(row[hint.reasonField]);
  return (
    <span data-hint-tone={tone} className="flex min-w-0 flex-col gap-0.5">
      <span className={cn("font-medium", tone !== undefined && HINT_TONE_TEXT_CLASS[tone])}>
        {sentence}
      </span>
      {detail !== undefined && <small className="text-xs text-muted-foreground">{detail}</small>}
      {reason !== undefined &&
        (insideRowOpener ? (
          <small data-hint-reason="true" className="text-xs text-muted-foreground">
            {reason}
          </small>
        ) : (
          <ReasonToggle label={hint.reasonLabel} reason={reason} />
        ))}
    </span>
  );
}
