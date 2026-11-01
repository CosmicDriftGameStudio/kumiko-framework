import { AlertTriangle, Check, Loader2, Lock, X } from "lucide-react";
import { type ReactNode, useId } from "react";
import { usePrimitives, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { Checkbox } from "../ui/checkbox.tsx";
import { StatusBadge, type StatusBadgeTone } from "./status-badge.tsx";
import type { StepSelectability, StepSelectionState, StepStatus } from "./step-list-selection.ts";

export type { StepSelectability, StepStatus } from "./step-list-selection.ts";

export type StepAction = {
  readonly id: string;
  readonly label: string;
  readonly onClick: () => void;
  readonly variant?: "primary" | "secondary" | "ghost";
  readonly disabled?: boolean;
  readonly pending?: boolean;
};

export type StepTag = {
  readonly label: string;
  readonly tone?: "accent" | "muted" | "warn" | "ok" | "bad";
  /** A note about the step's history (e.g. just changed) reads after what it waits for. */
  readonly afterWaiting?: boolean;
};

export type StepListItem = {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly status: StepStatus;
  /** Shown for "locked" as muted tag "Wartet auf: ..." and as the icon's accessible name. */
  readonly lockedReason?: string;
  readonly tags?: readonly StepTag[];
  readonly meta?: string;
  readonly link?: {
    readonly label: string;
    readonly href?: string;
    readonly onClick?: () => void;
    /** "below" puts an action that changes the step (e.g. taking a rejection back) under its text; default is the trailing link to what the step made. */
    readonly placement?: "trailing" | "below";
  };
  /** Where the step comes from, e.g. "Quelle: Seite 3, § 5" (caller-localized); each renders as a link under the description. */
  readonly sources?: readonly StepSource[];
  /** Marks the step the reader is looking at (warm background). */
  readonly highlighted?: boolean;
  /** Read only when the list has `selection`. Default: selectable while open or locked, otherwise none. */
  readonly selectable?: StepSelectability;
  /** Ids of prerequisite steps; selecting this step selects them too. */
  readonly dependsOn?: readonly string[];
  /** Rendered only while status is "open". */
  readonly actions?: readonly StepAction[];
};

export type StepSource = {
  readonly label: string;
  readonly onClick: () => void;
};

const STATUS_LABEL_KEY: Record<StepStatus, string> = {
  done: "kumiko.widget.step-list.statusDone",
  open: "kumiko.widget.step-list.statusOpen",
  locked: "kumiko.widget.step-list.statusLocked",
  running: "kumiko.widget.step-list.statusRunning",
  rejected: "kumiko.widget.step-list.statusRejected",
  failed: "kumiko.widget.step-list.statusFailed",
};

const ICON_BOX = "flex size-5 max-md:size-[20px] shrink-0 items-center justify-center rounded-full";

function StatusGlyph({ status }: { readonly status: StepStatus }): ReactNode {
  switch (status) {
    case "done":
      return <Check aria-hidden="true" className="size-3" strokeWidth={2.5} />;
    case "locked":
      return <Lock aria-hidden="true" className="size-3.5" />;
    case "running":
      return <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />;
    case "rejected":
      return <X aria-hidden="true" className="size-3" strokeWidth={2} />;
    case "failed":
      return <AlertTriangle aria-hidden="true" className="size-3.5" />;
    case "open":
      return null;
  }
}

const STATUS_ICON_CLASS: Record<StepStatus, string> = {
  done: "bg-status-ok text-background",
  open: "box-border border-[1.5px] border-primary",
  locked: "text-muted-foreground",
  running: "text-primary",
  rejected: "bg-border-row text-foreground-secondary",
  failed: "text-status-bad",
};

function StatusIcon({ step }: { readonly step: StepListItem }): ReactNode {
  const t = useTranslation();
  const label =
    step.status === "locked" && step.lockedReason !== undefined
      ? t("kumiko.widget.step-list.waitingFor", { reason: step.lockedReason })
      : t(STATUS_LABEL_KEY[step.status]);
  return (
    <span
      role="img"
      aria-label={label}
      data-status={step.status}
      className={cn(ICON_BOX, STATUS_ICON_CLASS[step.status])}
    >
      <StatusGlyph status={step.status} />
    </span>
  );
}

function tagTone(tone: StepTag["tone"]): StatusBadgeTone {
  return tone ?? "muted";
}

function StepLink({ link }: { readonly link: NonNullable<StepListItem["link"]> }): ReactNode {
  const { Link, Button } = usePrimitives();
  if (link.href !== undefined) {
    return (
      <Link
        href={link.href}
        onPress={link.onClick}
        className="shrink-0 text-[13px] font-medium underline underline-offset-2"
      >
        {link.label}
      </Link>
    );
  }
  return (
    <Button variant="link" size="sm" onClick={link.onClick} className="shrink-0 text-[13px]">
      {link.label}
    </Button>
  );
}

function StepBelowLink({ link }: { readonly link: NonNullable<StepListItem["link"]> }): ReactNode {
  const { Button } = usePrimitives();
  return (
    <Button
      variant="link"
      size="sm"
      onClick={link.onClick}
      className="h-auto self-start p-0 text-[13px] font-medium"
    >
      {link.label}
    </Button>
  );
}

export function StepActionButton({
  action,
  className,
}: {
  readonly action: StepAction;
  readonly className?: string;
}): ReactNode {
  const { Button } = usePrimitives();
  return (
    <Button
      size="sm"
      variant={action.variant ?? "secondary"}
      disabled={action.disabled}
      loading={action.pending}
      onClick={action.onClick}
      testId={`step-action-${action.id}`}
      className={cn("max-md:text-[14px]", className)}
    >
      {action.label}
    </Button>
  );
}

// A long reason ("Wartet auf: Whg. 3, Stellplatz 7, …") is cut at the column edge instead of running out of it.
function StepTagBadge({
  tone,
  label,
  className,
}: {
  readonly tone: StatusBadgeTone;
  readonly label: string;
  readonly className?: string;
}): ReactNode {
  return (
    <span className="flex min-w-0 max-w-full" title={label}>
      <StatusBadge tone={tone} className={cn("min-w-0 max-w-full", className)}>
        <span className="truncate">{label}</span>
      </StatusBadge>
    </span>
  );
}

// Sources and tags share one line: a source link and the step it waits for read as one fact.
// The phone card reads the waiting reason as a plain second line, not as a pill.
const PHONE_WAITING_TEXT_CLASS =
  "max-md:h-auto max-md:rounded-none max-md:bg-transparent max-md:px-0 max-md:text-[13px] max-md:font-normal max-md:text-foreground-secondary max-md:[&>[data-status-dot]]:hidden";

function StepSourcesAndTags({
  step,
  phoneCard,
}: {
  readonly step: StepListItem;
  readonly phoneCard: boolean;
}): ReactNode {
  const t = useTranslation();
  const tags = step.tags ?? [];
  const sources = step.sources ?? [];
  const waiting = step.status === "locked" && step.lockedReason !== undefined;
  if (tags.length === 0 && sources.length === 0 && !waiting) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px]">
      <StepSources step={step} />
      {tags
        .filter((tag) => tag.afterWaiting !== true)
        .map((tag) => (
          <StepTagBadge key={tag.label} tone={tagTone(tag.tone)} label={tag.label} />
        ))}
      {waiting && (
        <StepTagBadge
          tone="muted"
          label={t("kumiko.widget.step-list.waitingFor", { reason: step.lockedReason ?? "" })}
          {...(phoneCard && { className: PHONE_WAITING_TEXT_CLASS })}
        />
      )}
      {tags
        .filter((tag) => tag.afterWaiting === true)
        .map((tag) => (
          <StepTagBadge key={tag.label} tone={tagTone(tag.tone)} label={tag.label} />
        ))}
    </div>
  );
}

function StepSources({ step }: { readonly step: StepListItem }): ReactNode {
  const { Button } = usePrimitives();
  return (
    <>
      {(step.sources ?? []).map((source) => (
        <Button
          key={source.label}
          variant="link"
          size="sm"
          onClick={source.onClick}
          className="h-auto p-0 text-[13px] underline underline-offset-2"
          testId={`step-${step.id}-source`}
        >
          {source.label}
        </Button>
      ))}
    </>
  );
}

function StepActions({ step }: { readonly step: StepListItem }): ReactNode {
  const actions = step.status === "open" ? (step.actions ?? []) : [];
  if (actions.length === 0) return null;
  return (
    <div className="flex gap-2 pt-0.5">
      {actions.map((action) => (
        <StepActionButton key={action.id} action={action} />
      ))}
    </div>
  );
}

export type StepRowSelection = {
  readonly state: StepSelectionState;
  readonly onToggle: () => void;
};

function selectionTags(
  state: StepSelectionState,
  t: ReturnType<typeof useTranslation>,
): readonly StepTag[] {
  if (state.kind === "missing-input") {
    return [{ label: t("kumiko.widget.step-list.missingInput"), tone: "warn" }];
  }
  if (state.kind === "selectable" && state.neededFor !== undefined) {
    return [
      {
        label: t("kumiko.widget.step-list.autoSelected", { title: state.neededFor }),
        tone: "muted",
      },
    ];
  }
  return [];
}

function StepSelectionCell({
  step,
  selection,
}: {
  readonly step: StepListItem;
  readonly selection: StepRowSelection;
}): ReactNode {
  const t = useTranslation();
  const reasonId = useId();
  const { state } = selection;
  if (state.kind === "none") return <span aria-hidden="true" className="w-4 shrink-0" />;
  const reason =
    state.kind === "missing-input"
      ? state.reason
      : state.kind === "blocked"
        ? t("kumiko.widget.step-list.prerequisiteNotSelectable", { title: state.blockedBy })
        : undefined;
  return (
    <span className="flex h-5 w-4 shrink-0 items-center">
      <Checkbox
        aria-label={t("kumiko.widget.step-list.selectStep", { title: step.title })}
        checked={state.kind === "selectable" && state.checked}
        disabled={state.kind !== "selectable"}
        onCheckedChange={selection.onToggle}
        data-testid={`step-${step.id}-select`}
        {...(reason !== undefined && { title: reason, "aria-describedby": reasonId })}
      />
      {reason !== undefined && (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
    </span>
  );
}

function isAutoSelected(selection: StepRowSelection | undefined): boolean {
  return selection?.state.kind === "selectable" && selection.state.neededFor !== undefined;
}

function stepRowClassName(step: StepListItem, autoSelected: boolean): string {
  return cn(
    "flex gap-2.5 border-b border-border-row px-4 py-3",
    autoSelected &&
      "relative before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary/60",
    step.status === "open" && "bg-card",
    step.highlighted === true && "bg-status-warn-surface",
  );
}

function StepRowText({
  step,
  shownStep,
  phoneCard,
}: {
  readonly step: StepListItem;
  readonly shownStep: StepListItem;
  readonly phoneCard: boolean;
}): ReactNode {
  return (
    <div className="flex min-w-0 grow flex-col gap-1">
      <span
        className={cn(
          "font-medium",
          step.status === "rejected" && "text-muted-foreground line-through",
        )}
        data-testid={`step-${step.id}-title`}
      >
        {step.title}
      </span>
      {step.description !== undefined && (
        <span className="text-[13px] text-foreground-secondary">{step.description}</span>
      )}
      <StepSourcesAndTags step={shownStep} phoneCard={phoneCard} />
      {step.meta !== undefined && (
        <span className="text-[13px] text-muted-foreground">{step.meta}</span>
      )}
      {step.link?.placement === "below" && <StepBelowLink link={step.link} />}
      <StepActions step={step} />
    </div>
  );
}

export function StepRow({
  step,
  phoneCard = false,
  selection,
}: {
  readonly step: StepListItem;
  readonly phoneCard?: boolean;
  readonly selection?: StepRowSelection;
}): ReactNode {
  const t = useTranslation();
  const shownStep =
    selection === undefined
      ? step
      : { ...step, tags: [...(step.tags ?? []), ...selectionTags(selection.state, t)] };
  return (
    <li
      data-testid={`step-${step.id}`}
      className={stepRowClassName(step, isAutoSelected(selection))}
      {...(step.highlighted === true && { "aria-current": "step" as const })}
    >
      {selection !== undefined && <StepSelectionCell step={step} selection={selection} />}
      <StatusIcon step={step} />
      <StepRowText step={step} shownStep={shownStep} phoneCard={phoneCard} />
      {step.link !== undefined && step.link.placement !== "below" && <StepLink link={step.link} />}
    </li>
  );
}
