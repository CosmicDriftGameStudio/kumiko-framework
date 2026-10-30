export type MaintenanceWindow = { readonly hour: number; readonly minute: number };

export const MAINTENANCE_WINDOW_ENV = "KUMIKO_MAINTENANCE_WINDOW";

export const DEFAULT_MAINTENANCE_WINDOW: MaintenanceWindow = { hour: 3, minute: 0 };

const MAINTENANCE_WINDOW_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// UTC wall clock, so the window does not move with the server time zone or DST.
export function maintenanceWindowFromEnv(
  env: Record<string, string | undefined> = process.env,
): MaintenanceWindow {
  const raw = env[MAINTENANCE_WINDOW_ENV]?.trim();
  if (raw === undefined || raw === "") return DEFAULT_MAINTENANCE_WINDOW;
  const match = MAINTENANCE_WINDOW_PATTERN.exec(raw);
  if (match === null) {
    throw new Error(
      `${MAINTENANCE_WINDOW_ENV}="${raw}" is invalid: expected HH:MM in UTC, e.g. "03:00" or "22:45".`,
    );
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}
