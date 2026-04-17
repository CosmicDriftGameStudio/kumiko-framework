// Qualified Name (QN) system: unified naming pattern for all framework identifiers.
// Pattern: "scope:type:name" — colon-separated, kebab-case segments.
//
// The name part can contain colons for sub-structure (e.g. "task:create").
// Scope and type are always single segments. Name is everything after the second colon.
//
// Examples:
//   "tasks:write:task:create"      → scope=tasks, type=write, name=task:create
//   "system:hook:search-index"     → scope=system, type=hook, name=search-index
//   "billing:notify:invoice-sent"  → scope=billing, type=notify, name=invoice-sent

// Built-in QN types used by the framework.
// Features can define additional types — the type segment is validated for format only, not membership.
export const QnTypes = {
  write: "write",
  query: "query",
  hook: "hook",
  job: "job",
  notify: "notify",
  event: "event",
  channel: "channel",
  config: "config",
} as const;

export type BuiltinQnType = (typeof QnTypes)[keyof typeof QnTypes];

// QnType is string — framework types are predefined, but features can use custom types.
export type QnType = string;

const QN_SEGMENT = /^[a-z][a-z0-9-]*$/;

export type ParsedQn = {
  scope: string;
  type: string;
  name: string; // may contain colons (e.g. "task:create")
};

function validateSegment(value: string, label: string, context?: string): void {
  if (!QN_SEGMENT.test(value)) {
    const suffix = context ? ` in "${context}"` : "";
    throw new Error(`Invalid QN ${label} "${value}"${suffix}: must match ${QN_SEGMENT}`);
  }
}

// Build a qualified name from parts. Validates all segments.
// The name can contain colons for sub-structure (e.g. "task:create").
export function qn(scope: string, type: QnType, name: string): string {
  validateSegment(scope, "scope");
  validateSegment(type, "type");
  for (const part of name.split(":")) {
    validateSegment(part, "name");
  }
  return `${scope}:${type}:${name}`;
}

// Parse a qualified name string into its parts.
// Splits on the first two colons — everything after is the name (which may contain colons).
export function parseQn(value: string): ParsedQn {
  const first = value.indexOf(":");
  if (first < 0)
    throw new Error(`Invalid QN "${value}": expected at least 3 colon-separated segments`);
  const second = value.indexOf(":", first + 1);
  if (second < 0)
    throw new Error(`Invalid QN "${value}": expected at least 3 colon-separated segments`);

  const scope = value.slice(0, first);
  const type = value.slice(first + 1, second);
  const name = value.slice(second + 1);

  validateSegment(scope, "scope", value);
  validateSegment(type, "type", value);
  for (const part of name.split(":")) {
    validateSegment(part, "name", value);
  }

  return { scope, type, name };
}

// Check if a string is a valid qualified name.
export function isValidQn(value: string): boolean {
  try {
    parseQn(value);
    return true;
  } catch {
    return false;
  }
}

// True if `name` is a valid QN segment (lowercase letters, digits, dashes;
// starts with a letter). Same rule as `QN_SEGMENT` — kept public so feature
// registration can reject bad names at the source instead of at registry-boot.
export function isKebabSegment(name: string): boolean {
  return QN_SEGMENT.test(name);
}

// Convert camelCase or dot.separated strings to kebab-case.
// "task.create" → "task-create"
// "ticketAssigned" → "ticket-assigned"
// "billingPeriod.create" → "billing-period-create"
// "monthlyReport" → "monthly-report"
// Already kebab-case → unchanged
// Colons are preserved: "task:create" → "task:create"
export function toKebab(input: string): string {
  return input
    .replace(/\./g, "-") // dots → dashes
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2") // consecutive uppercase: SSEBroadcast → SSE-Broadcast
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2") // camelCase boundaries: ticketAssigned → ticket-Assigned
    .toLowerCase();
}
