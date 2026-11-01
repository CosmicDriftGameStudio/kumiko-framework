import type { PresenceEntry } from "@cosmicdrift/kumiko-types/presence-types";
import type { ReactNode } from "react";
import { useTranslation } from "../../index.ts";
import { Avatar } from "../layout/avatar.tsx";

const DEFAULT_MAX_AVATARS = 3;

export type PresenceAvatarsProps = {
  readonly entries: readonly PresenceEntry[];
  readonly max?: number;
  readonly testId?: string;
};

/** Small round avatars of the people on a row, with "+n" for the rest; for list rows. */
export function PresenceAvatars({
  entries,
  max = DEFAULT_MAX_AVATARS,
  testId,
}: PresenceAvatarsProps): ReactNode {
  const t = useTranslation();
  if (entries.length === 0) return null;

  const shown = entries.slice(0, max);
  const hiddenCount = entries.length - shown.length;
  const names = t("kumiko.widget.presence.avatarsLabel", {
    names: entries.map((entry) => entry.displayName).join(", "),
  });

  return (
    <span
      data-testid={testId}
      role="img"
      aria-label={names}
      title={names}
      className="inline-flex items-center -space-x-1"
    >
      {shown.map((entry) => (
        <Avatar
          key={entry.userId}
          id={entry.userId}
          label={entry.displayName}
          size="xs"
          shape="round"
        />
      ))}
      {hiddenCount > 0 && (
        <span className="pl-1.5 text-[11px] text-muted-foreground">+{hiddenCount}</span>
      )}
    </span>
  );
}
