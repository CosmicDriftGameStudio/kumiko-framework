// Public-Surface des Items-Features. Server importiert `itemsFeature`,
// Client importiert `itemsClient`. schema.ts ist intern, wird nicht
// re-exported — nur feature.ts und client.ts dürfen darauf zugreifen.

export { itemsClient } from "./client";
export { itemsFeature } from "./feature";
