// Process-local caches (tier sets, file providers, tenant timezone) announce
// changes here so every replica drops its copy. publish() reaches subscribers
// in this process synchronously and subscribers in other processes
// asynchronously.
export type CacheSyncBus = {
  publish(topic: string, message: unknown): void;
  subscribe(topic: string, listener: (message: unknown) => void): () => void;
  // Fires after the transport re-established its subscription following a
  // connection loss; messages sent meanwhile are lost, so caches reload.
  onResync(listener: () => void): () => void;
};

export type ClosableCacheSyncBus = CacheSyncBus & { close(): Promise<void> };
