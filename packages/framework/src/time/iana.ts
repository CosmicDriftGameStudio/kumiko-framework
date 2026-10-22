// IANA time zone name validation. Intl.supportedValuesOf("timeZone") returns only
// CANONICAL names — valid aliases such as "US/Pacific", "GMT", and "Etc/UTC" are
// missing, even though Intl.DateTimeFormat, Temporal, and ctx.tz.parse all
// accept them without issue. Intl.DateTimeFormat itself is case-INSENSITIVE
// ("europe/berlin" resolves to "Europe/Berlin") — a simple try/catch would
// therefore allow capitalization errors through.
// The exact comparison with resolvedOptions().timeZone prevents this: a valid
// canonical name OR alias ALWAYS resolves to itself (verified empirically for
// US/Pacific, GMT, and Etc/UTC), while a incorrectly cased string resolves to
// the canonical form and no longer matches exactly.
export function isValidIanaTimeZone(value: string): boolean {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { timeZone: value }).resolvedOptions().timeZone === value
    );
  } catch {
    return false;
  }
}
