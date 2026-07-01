// IANA-Zonenname-Validierung. Intl.supportedValuesOf("timeZone") liefert nur
// KANONISCHE Namen — gültige Aliase wie "US/Pacific", "GMT", "Etc/UTC" fehlen
// darin, obwohl Intl.DateTimeFormat, Temporal und ctx.tz.parse sie alle
// klaglos akzeptieren. Intl.DateTimeFormat selbst ist aber case-INSENSITIVE
// ("europe/berlin" resolved klaglos zu "Europe/Berlin") — ein reines
// try/catch würde also Tippfehler in der Groß-/Kleinschreibung durchlassen.
// Der exakte Vergleich mit resolvedOptions().timeZone schließt das: ein
// gültiger kanonischer Name ODER Alias resolved IMMER zu sich selbst
// (empirisch verifiziert für US/Pacific, GMT, Etc/UTC), ein falsch-gecasteter
// String resolved zur kanonischen Form und matcht damit nicht mehr exakt.
export function isValidIanaTimeZone(value: string): boolean {
  try {
    return (
      new Intl.DateTimeFormat(undefined, { timeZone: value }).resolvedOptions().timeZone === value
    );
  } catch {
    return false;
  }
}
