// IANA-Zonenname-Validierung gegen die Runtime-eigene Zonenliste
// (Intl.supportedValuesOf). Das Set wird lazy einmal gebaut — der Aufbau ist
// der teure Teil (~400 kanonische Zonen), das Lookup danach O(1).

let supportedZones: ReadonlySet<string> | undefined;

function ianaZoneSet(): ReadonlySet<string> {
  if (supportedZones === undefined) {
    supportedZones = new Set(Intl.supportedValuesOf("timeZone"));
  }
  return supportedZones;
}

/** True wenn `value` ein gültiger kanonischer IANA-Zonenname ist (z.B. "Europe/Berlin", "UTC"). */
export function isValidIanaTimeZone(value: string): boolean {
  return ianaZoneSet().has(value);
}
