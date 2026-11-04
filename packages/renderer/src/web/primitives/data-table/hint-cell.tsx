import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useState } from "react";
import type { ListColumnHintViewModel } from "../../../headless/index.ts";
import { isSelectOptionTone } from "../../../status-tone.ts";
import { cn } from "../../lib/cn.ts";
import { ReasonBox, ReasonInfoButton } from "../reason-box.tsx";

export const HINT_TONE_TEXT_CLASS: Readonly<Record<SelectOptionTone, string>> = {
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

const OPEN_SENTENCE_CLASS =
  "min-w-0 cursor-pointer bg-transparent p-0 text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** "To do" cell: an emphasized sentence in the row tone with an optional muted second line. */
export function HintCell({
  value,
  row,
  hint,
  onOpen,
}: {
  readonly value: unknown;
  readonly row: Readonly<Record<string, unknown>>;
  readonly hint: ListColumnHintViewModel;
  // The first cell of a clickable row opens it from the sentence only: a wrapping button could not hold the reason toggle.
  readonly onOpen?: () => void;
}): ReactNode {
  const [reasonOpen, setReasonOpen] = useState(false);
  const sentence = nonEmptyText(value);
  if (sentence === undefined) {
    // Without a sentence the empty label is the only element of the first cell, so it must stay
    // the keyboard opener of a clickable row.
    return onOpen === undefined ? (
      <span data-hint-empty="true" className="text-muted-foreground">
        {hint.emptyLabel}
      </span>
    ) : (
      <button
        type="button"
        data-hint-empty="true"
        className={cn(OPEN_SENTENCE_CLASS, "font-normal text-muted-foreground")}
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        {hint.emptyLabel}
      </button>
    );
  }
  const toneValue = hint.toneField === undefined ? undefined : row[hint.toneField];
  const tone = isSelectOptionTone(toneValue) ? toneValue : undefined;
  const detail = hint.detailField === undefined ? undefined : nonEmptyText(row[hint.detailField]);
  const reason = hint.reasonField === undefined ? undefined : nonEmptyText(row[hint.reasonField]);
  const sentenceClass = cn(
    "font-medium",
    hint.plainSentence !== true && tone !== undefined && HINT_TONE_TEXT_CLASS[tone],
  );
  return (
    <span data-hint-tone={tone} className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-start gap-2">
        {onOpen === undefined ? (
          <span className={sentenceClass}>{sentence}</span>
        ) : (
          <button
            type="button"
            className={cn(OPEN_SENTENCE_CLASS, sentenceClass)}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              event.stopPropagation();
              onOpen();
            }}
          >
            {sentence}
          </button>
        )}
        {reason !== undefined && (
          <ReasonInfoButton
            label={hint.reasonLabel}
            open={reasonOpen}
            onToggle={() => setReasonOpen((open) => !open)}
            data-hint-reason-toggle="true"
          />
        )}
      </span>
      {detail !== undefined && <small className="text-xs text-muted-foreground">{detail}</small>}
      {reason !== undefined && reasonOpen && (
        <ReasonBox data-hint-reason="true">{reason}</ReasonBox>
      )}
    </span>
  );
}
