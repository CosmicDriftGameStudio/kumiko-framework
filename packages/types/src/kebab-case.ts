// Convert camelCase or dot.separated strings to kebab-case.
// "task.create" → "task-create"
// "ticketAssigned" → "ticket-assigned"
// "billing-period.create" → "billing-period-create"
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
