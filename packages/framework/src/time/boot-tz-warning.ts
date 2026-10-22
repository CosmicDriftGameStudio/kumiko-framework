// Warn at boot when the process time zone is not UTC. All server code assumes UTC
// (the system time zone is not a framework concept); a different process time zone
// can make accidental new Date() paths behave differently locally ("green in UTC-CI,
// broken in Berlin production"). This is a soft check: non-UTC is legitimate in
// development, so warn instead of failing boot.

function resolvedServerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Warn once at server startup when the process time zone is not UTC.
 * Parameters are injectable for tests. Returns whether a warning was emitted.
 */
export function warnIfNonUtcServerTimeZone(
  resolvedTimeZone: string = resolvedServerTimeZone(),
  // biome-ignore lint/suspicious/noConsole: runs before any logger exists; the default is the only console sink
  warn: (message: string) => void = console.warn,
): boolean {
  // GMT and Etc/UTC are UTC-equivalent (no offset, no DST) — TZ=GMT is a
  // legitimate way to pin a process to UTC and must not trip this warning.
  if (resolvedTimeZone === "UTC" || resolvedTimeZone === "GMT" || resolvedTimeZone === "Etc/UTC") {
    return false;
  }
  warn(
    `[kumiko] Server time zone is "${resolvedTimeZone}" — the framework assumes UTC. ` +
      "Set TZ=UTC for the server process to avoid time-zone-dependent bugs.",
  );
  return true;
}
