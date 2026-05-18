// ISO-8601 duration arithmetic — shared by wait and waitForEvent steps.
// Accepts "P1D", "PT1H", "P1Y2M3DT4H5M6S" etc.
// Uses approximate calendar math (365d/year, 30d/month). See #23.

export function addDuration(baseIso: string, duration: string): string {
  const pattern = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;
  const match = duration.match(pattern);
  if (!match) {
    throw new Error(
      `Invalid ISO-8601 duration "${duration}" — expected format like "PT1H", "P1D", "P7D"`,
    );
  }

  const parts = match.slice(1).map((n) => Number(n) || 0);
  const years = parts[0] ?? 0;
  const months = parts[1] ?? 0;
  const days = parts[2] ?? 0;
  const hours = parts[3] ?? 0;
  const minutes = parts[4] ?? 0;
  const seconds = parts[5] ?? 0;

  // Compute in ms (Temporal.Instant.add accepts only smaller units below
  // hours for calendar-agnostic shifts; we approximate years/months as
  // fixed-length days, see file header).
  let ms = years * 365 * 24 * 60 * 60 * 1000;
  ms += months * 30 * 24 * 60 * 60 * 1000;
  ms += days * 24 * 60 * 60 * 1000;
  ms += hours * 60 * 60 * 1000;
  ms += minutes * 60 * 1000;
  ms += seconds * 1000;

  return Temporal.Instant.from(baseIso).add({ milliseconds: ms }).toString();
}
