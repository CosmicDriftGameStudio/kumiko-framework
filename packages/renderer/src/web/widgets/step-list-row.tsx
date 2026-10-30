import { AlertTriangle, Check, Loader2, Lock, X } from "lucide-react";
import type { ReactNode } from "react";
import { usePrimitives, useTranslation } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { StatusBadge, type StatusBadgeTone } from "./status-badge.tsx";

export type StepStatus = "done" | "open" | "locked" | "running" | "rejected" | "failed";

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
  };
  /** Where the step comes from, e.g. "Quelle: Seite 3, § 5" (caller-localized); each renders as a link under the description. */
  readonly sources?: readonly StepSource[];
  /** Marks the step the reader is looking at (warm background). */
  readonly highlighted?: boolean;
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

const ICON_BOX = "flex size-5 shrink-0 items-center justify-center rounded-full";

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
      <Link href={link.href} onPress={link.onClick} className="shrink-0 text-[13px] font-medium">
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

export function StepActionButton({ action }: { readonly action: StepAction }): ReactNode {
  const { Button } = usePrimitives();
  return (
    <Button
      size="sm"
      variant={action.variant ?? "secondary"}
      disabled={action.disabled}
      loading={action.pending}
      onClick={action.onClick}
      testId={`step-action-${action.id}`}
    >
      {action.label}
    </Button>
  );
}

function StepTags({ step }: { readonly step: StepListItem }): ReactNode {
  const t = useTranslation();
  const tags = step.tags ?? [];
  const waiting = step.status === "locked" && step.lockedReason !== undefined;
  if (tags.length === 0 && !waiting) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <StatusBadge key={tag.label} tone={tagTone(tag.tone)}>
          {tag.label}
        </StatusBadge>
      ))}
      {waiting && (
        <StatusBadge tone="muted">
          {t("kumiko.widget.step-list.waitingFor", { reason: step.lockedReason ?? "" })}
        </StatusBadge>
      )}
    </div>
  );
}

function StepSources({ step }: { readonly step: StepListItem }): ReactNode {
  const { Button } = usePrimitives();
  const sources = step.sources ?? [];
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-3">
      {sources.map((source) => (
        <Button
          key={source.label}
          variant="link"
          size="sm"
          onClick={source.onClick}
          className="h-auto p-0 text-[13px]"
          testId={`step-${step.id}-source`}
        >
          {source.label}
        </Button>
      ))}
    </div>
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

export function StepRow({ step }: { readonly step: StepListItem }): ReactNode {
  const rejected = step.status === "rejected";
  return (
    <li
      data-testid={`step-${step.id}`}
      className={cn(
        "flex gap-2.5 border-b border-border-row px-4 py-3",
        step.status === "open" && "bg-card",
        step.highlighted === true && "bg-status-warn-surface",
      )}
      {...(step.highlighted === true && { "aria-current": "step" as const })}
    >
      <StatusIcon step={step} />
      <div className="flex min-w-0 grow flex-col gap-1.5">
        <span
          className={cn("font-medium", rejected && "text-muted-foreground line-through")}
          data-testid={`step-${step.id}-title`}
        >
          {step.title}
        </span>
        {step.description !== undefined && (
          <span className="text-[13px] text-foreground-secondary">{step.description}</span>
        )}
        <StepSources step={step} />
        <StepTags step={step} />
        {step.meta !== undefined && (
          <span className="text-[13px] text-muted-foreground">{step.meta}</span>
        )}
        <StepActions step={step} />
      </div>
      {step.link !== undefined && <StepLink link={step.link} />}
    </li>
  );
}
