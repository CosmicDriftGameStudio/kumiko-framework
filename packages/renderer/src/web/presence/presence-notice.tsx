import type { PresenceEntry } from "@cosmicdrift/kumiko-types/presence-types";
import { type ReactNode, useEffect, useState } from "react";
import { pluralKey } from "../../headless/plural-key.ts";
import { useTranslation } from "../../index.ts";
import { Avatar } from "../layout/avatar.tsx";

const MINUTE_MS = 60_000;

export type PresenceNoticeProps = {
  readonly entries: readonly PresenceEntry[];
  /** Replaces the default "is looking at this / is editing this" text of the first entry. */
  readonly describe?: (entry: PresenceEntry) => ReactNode;
  /** Fixed "now" in epoch ms; without it the notice follows the clock once a minute. */
  readonly nowMs?: number;
  readonly testId?: string;
};

function useMinuteClock(fixedNowMs: number | undefined): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (fixedNowMs !== undefined) return;
    const timer = setInterval(() => setNowMs(Date.now()), MINUTE_MS);
    return () => clearInterval(timer);
  }, [fixedNowMs]);
  return fixedNowMs ?? nowMs;
}

/** One quiet line above a record: who else is on it and for how long. Renders nothing when
 *  nobody is. */
export function PresenceNotice({
  entries,
  describe,
  nowMs,
  testId,
}: PresenceNoticeProps): ReactNode {
  const t = useTranslation();
  const now = useMinuteClock(nowMs);
  const [first] = entries;
  if (first === undefined) return null;

  const minutes = Math.floor((now - Date.parse(first.since)) / MINUTE_MS);
  const since =
    minutes < 1
      ? t("kumiko.widget.presence.sinceJustNow")
      : t("kumiko.widget.presence.sinceMinutes", { count: minutes });
  const text = describe ? describe(first) : t(`kumiko.widget.presence.${first.activity}`);
  const moreCount = entries.length - 1;

  return (
    <div
      data-testid={testId}
      role="status"
      className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-[13px] text-foreground"
    >
      <Avatar id={first.userId} label={first.displayName} size="xs" shape="round" />
      <span className="min-w-0 flex-1 truncate">
        <strong className="font-semibold">{first.displayName}</strong> {text}
        {moreCount > 0 && (
          <>
            {" · "}
            {t(pluralKey("kumiko.widget.presence.moreOthers", moreCount), { count: moreCount })}
          </>
        )}
      </span>
      <span className="shrink-0 text-muted-foreground">{since}</span>
    </div>
  );
}
