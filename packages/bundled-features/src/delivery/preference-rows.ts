import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { currentNotificationType } from "./notification-type-aliases.ts";

type PreferenceRow = {
  readonly userId: string;
  readonly notificationType: string;
  readonly channel: string;
  readonly enabled: boolean;
};

// Rows stored under a former notification name are reported under the current
// one, collapsed with the same precedence as delivery: an exact row wins,
// otherwise any disabled former-name row disables.
export function collapsePreferenceRows<Row extends PreferenceRow>(
  registry: Registry,
  rows: readonly Row[],
): Row[] {
  const collapsed = new Map<string, { row: Row; isExact: boolean }>();
  for (const row of rows) {
    const notificationType = currentNotificationType(registry, row.notificationType);
    const key = `${row.userId}\u0000${notificationType}\u0000${row.channel}`;
    const isExact = row.notificationType === notificationType;
    const existing = collapsed.get(key);
    if (existing?.isExact) continue;
    const formerNameRowDisablesAlready =
      existing !== undefined &&
      !isExact &&
      (existing.row.enabled === false || row.enabled !== false);
    if (formerNameRowDisablesAlready) continue;
    collapsed.set(key, { row: { ...row, notificationType }, isExact });
  }
  return [...collapsed.values()].map((entry) => entry.row);
}
