// Minimal shape of the httpRoute handler's `{ systemQuery }` dep — mirrors
// http-route.ts's signature. Not importing HttpRouteHandlerDeps itself: it
// isn't part of the engine's public surface (only the httpRoute-
// registration types are).
export type SystemQueryFn = (type: string, payload: unknown, tenantId: string) => Promise<unknown>;
