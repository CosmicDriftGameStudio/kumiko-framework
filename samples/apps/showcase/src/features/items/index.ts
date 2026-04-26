// Public-Surface des Items-Features. Server importiert `itemsFeature`,
// Web-Client importiert `itemsClient`. schema/ ist intern, wird nicht
// re-exported — nur feature.ts und web/index.ts dürfen darauf zugreifen.

export { itemsFeature } from "./feature";
export { itemsClient } from "./web";
