import { useMemo } from "react";
import { useAppFeatures } from "../app/app-features-context.tsx";
import type { FeatureSchema } from "../app/feature-schema.ts";
import { toKebab } from "../app/qn.ts";
import type { LiveEvent, LiveEventSubscriber } from "../sse/live-events.tsx";

// Entity of a standard `<feature>:query:<entity>:<verb>` type; undefined for
// non-conforming types so live mode skips them instead of subscribing to a
// channel no event will ever match.
export function entityFromQueryType(type: string): string | undefined {
  const parts = type.split(":");
  if (parts.length !== 4) return undefined;
  if (parts[1] !== "query") return undefined;
  return parts[2];
}

// The server signals both the r.entity() name and its kebab-case form (executors
// may write under either), so the client listens on both.
export function liveEntitiesForQuery(
  type: string,
  features: readonly FeatureSchema[],
): readonly string[] {
  const names = new Set<string>();
  const nameSegment = entityFromQueryType(type);
  if (nameSegment !== undefined) names.add(nameSegment);
  for (const feature of features) {
    for (const entity of feature.queryLiveEntities?.[type] ?? []) names.add(entity);
  }
  const subscribed = new Set<string>();
  for (const name of names) {
    subscribed.add(name);
    subscribed.add(toKebab(name));
  }
  return [...subscribed].sort();
}

export function useLiveEntitiesForQuery(type: string): readonly string[] {
  const features = useAppFeatures();
  const featuresKey = useMemo(
    () => liveEntitiesForQuery(type, features).join("\n"),
    [type, features],
  );
  return useMemo(() => (featuresKey === "" ? [] : featuresKey.split("\n")), [featuresKey]);
}

export function subscribeToEntities(
  subscribe: LiveEventSubscriber,
  entities: readonly string[],
  listener: (event: LiveEvent) => void,
): () => void {
  const unsubscribers = entities.map((entity) => subscribe(entity, listener));
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
