// Boot-Warnung wenn die Prozess-Uhr nicht in UTC läuft. Der gesamte
// Server-Code nimmt UTC an (System-TZ ist kein Konzept — siehe timezones.md);
// eine abweichende Prozess-TZ lässt versehentliche new Date()-Pfade
// lokal-abhängig brechen ("grün in UTC-CI, kaputt in Berlin-Prod"). Soft:
// nicht-UTC ist in Dev legitim, daher Warnung statt Boot-Fehler.

function resolvedServerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Warnt einmalig beim Server-Start, wenn die Prozess-TZ nicht UTC ist.
 * Parameter sind für Tests injizierbar. Gibt zurück, ob gewarnt wurde.
 */
export function warnIfNonUtcServerTimeZone(
  resolvedTimeZone: string = resolvedServerTimeZone(),
  // biome-ignore lint/suspicious/noConsole: boot-time warning, no logger wired this early
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
