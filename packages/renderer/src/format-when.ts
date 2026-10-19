import { toInstant } from "./headless/index.ts";

// Shared timestamp formatter for operator screens (audit log, job runs) —
// falls back to the raw ISO string on an unparseable value instead of "Invalid Date".
export function formatWhen(value: string): string {
  try {
    return toInstant(value).toLocaleString();
  } catch {
    return value;
  }
}
