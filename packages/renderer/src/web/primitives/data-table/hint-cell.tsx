import type { SelectOptionTone } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ReactNode, useId, useState } from "react";
import type { ListColumnHintViewModel } from "../../../headless/index.ts";
import { isSelectOptionTone } from "../../../status-tone.ts";
import { cn } from "../../lib/cn.ts";
import { hintReasonOf, nonEmptyText, useHintReasonRowControl } from "../hint-reason-row.tsx";
import { ReasonBox, ReasonInfoButton } from "../reason-box.tsx";

export const HINT_TONE_TEXT_CLASS: Readonly<Record<SelectOptionTone, string>> = {
  bad: "text-status-bad",
  warn: "text-status-warn",
  critical: "text-status-critical",
  ok: "text-status-ok",
  accent: "text-primary",
  neutral: "",
};

/** Tone `neutral` dims the sentence like an empty label (muted, not bold); `plainSentence` opts out. */
function isDimmedHintSentence(
  tone: SelectOptionTone | undefined,
  plainSentence: boolean | undefined,
): boolean {
  return tone === "neutral" && plainSentence !== true;
}

const DIMMED_HINT_SENTENCE_CLASS = "font-normal text-muted-foreground";

const OPEN_SENTENCE_CLASS =
  "min-w-0 cursor-pointer bg-transparent p-0 text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function SentenceText({
  text,
  className,
  onOpen,
}: {
  readonly text: string;
  readonly className: string;
  readonly onOpen: (() => void) | undefined;
}): ReactNode {
  if (onOpen === undefined) return <span className={className}>{text}</span>;
  return (
    <button
      type="button"
      className={cn(OPEN_SENTENCE_CLASS, className)}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {text}
    </button>
  );
}

// Without a sentence the empty label is the only element of the first cell, so it must stay
// the keyboard opener of a clickable row.
function EmptyHint({
  label,
  onOpen,
}: {
  readonly label: string;
  readonly onOpen: (() => void) | undefined;
}): ReactNode {
  if (onOpen === undefined) {
    return (
      <span data-hint-empty="true" className="text-muted-foreground">
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-hint-empty="true"
      className={cn(OPEN_SENTENCE_CLASS, DIMMED_HINT_SENTENCE_CLASS)}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {label}
    </button>
  );
}

function useHintReason(hint: ListColumnHintViewModel, row: Readonly<Record<string, unknown>>) {
  const [ownOpen, setOwnOpen] = useState(false);
  const ownBoxId = useId();
  const rowReason = useHintReasonRowControl(hint);
  return {
    reason: hintReasonOf(hint, row),
    reasonOpen: rowReason?.open ?? ownOpen,
    toggleReason: rowReason?.onToggle ?? (() => setOwnOpen((open) => !open)),
    boxInRow: rowReason !== undefined,
    boxId: rowReason?.boxId ?? ownBoxId,
  };
}

export function hintSentenceClass(
  tone: SelectOptionTone | undefined,
  plainSentence: boolean | undefined,
  weight: "font-medium" | "font-semibold" = "font-medium",
) {
  if (isDimmedHintSentence(tone, plainSentence)) return DIMMED_HINT_SENTENCE_CLASS;
  return cn(weight, plainSentence !== true && tone !== undefined && HINT_TONE_TEXT_CLASS[tone]);
}

/** "To do" cell: an emphasized sentence in the row tone with an optional muted second line. */
export function HintCell({
  value,
  row,
  hint,
  onOpen,
  leading,
}: {
  readonly value: unknown;
  readonly row: Readonly<Record<string, unknown>>;
  readonly hint: ListColumnHintViewModel;
  /** Drawn in front of the sentence on its line (a badge or tone dot); the detail line starts below it, at the left edge. */
  readonly leading?: ReactNode;
  // The first cell of a clickable row opens it from the sentence only: a wrapping button could not hold the reason toggle.
  readonly onOpen?: () => void;
}): ReactNode {
  const { reason, reasonOpen, toggleReason, boxInRow, boxId } = useHintReason(hint, row);
  const sentence = nonEmptyText(value);
  if (sentence === undefined) return <EmptyHint label={hint.emptyLabel} onOpen={onOpen} />;
  const toneValue = hint.toneField === undefined ? undefined : row[hint.toneField];
  const tone = isSelectOptionTone(toneValue) ? toneValue : undefined;
  const detail = hint.detailField === undefined ? undefined : nonEmptyText(row[hint.detailField]);
  const sentenceClass = hintSentenceClass(tone, hint.plainSentence);
  return (
    <span data-hint-tone={tone} className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-start gap-2">
        {leading !== undefined && (
          <span className="flex h-[1lh] shrink-0 items-center">{leading}</span>
        )}
        <SentenceText text={sentence} className={sentenceClass} onOpen={onOpen} />
        {reason !== undefined && (
          <ReasonInfoButton
            label={hint.reasonLabel}
            open={reasonOpen}
            onToggle={toggleReason}
            controls={boxId}
            data-hint-reason-toggle="true"
          />
        )}
      </span>
      {detail !== undefined && <small className="text-xs text-muted-foreground">{detail}</small>}
      {reason !== undefined && reasonOpen && !boxInRow && (
        <ReasonBox
          id={boxId}
          data-hint-reason="true"
          {...(reason.title !== undefined && { title: reason.title })}
        >
          {reason.text}
        </ReasonBox>
      )}
    </span>
  );
}
