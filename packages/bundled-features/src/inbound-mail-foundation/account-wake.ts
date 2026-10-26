// Process-local wake channel between the account-event consumer (feature.ts) and the sync supervisor.
// A freshly connected, reconnected or re-activated mailbox is synced right away instead of waiting
// for the next poll tick. The consumer runs "per-instance", so every process wakes its own supervisor.
//
// Without a running event dispatcher in the process (or without a supervisor) nothing wakes anyone;
// the regular poll tick then picks the account up, so this is purely a latency optimisation.

export type MailAccountWakeListener = (tenantId: string, accountId: string) => void;

const listeners = new Set<MailAccountWakeListener>();

export function registerMailAccountWakeListener(listener: MailAccountWakeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function wakeMailAccount(tenantId: string, accountId: string): void {
  for (const listener of listeners) listener(tenantId, accountId);
}
