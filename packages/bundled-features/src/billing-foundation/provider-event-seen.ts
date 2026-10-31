import type { StoredEvent } from "@cosmicdrift/kumiko-framework/event-store";

export function hasSeenProviderEvent(
  existingEvents: readonly Pick<StoredEvent, "metadata">[],
  providerEvent: { readonly providerEventId: string; readonly providerName: string },
): boolean {
  return existingEvents.some((e) => {
    const headers = e.metadata.headers ?? {};
    return (
      headers["providerEventId"] === providerEvent.providerEventId &&
      headers["providerName"] === providerEvent.providerName
    );
  });
}
