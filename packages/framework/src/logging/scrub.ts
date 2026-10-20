const EMAIL_PATTERN =
  /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
// Postgres echoes the offending row values in constraint-violation details.
const PG_KEY_DETAIL_PATTERN = /Key \(([^)]*)\)=\(.*?\)(?=\s|$|[.,;])/g;
const PG_FAILING_ROW_PATTERN = /Failing row contains \(.*\)/g;

const JWT_PATTERN = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER_PATTERN = /Bearer\s+\S+/g;

export function scrubLogText(text: string): string {
  return text
    .replace(PG_KEY_DETAIL_PATTERN, "Key ($1)=(***)")
    .replace(PG_FAILING_ROW_PATTERN, "Failing row contains (***)")
    .replace(EMAIL_PATTERN, "$1***@$2")
    .replace(JWT_PATTERN, "[jwt]")
    .replace(BEARER_PATTERN, "Bearer [redacted]");
}

export function scrubLogValue(value: unknown): unknown {
  if (typeof value === "string") return scrubLogText(value);
  if (value instanceof Error) return scrubLogText(value.message);
  return value;
}
