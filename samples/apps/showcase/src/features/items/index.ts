// Public surface of the items feature. The server imports `itemsFeature`,
// the web client imports `itemsClient`. schema/ is internal, not
// re-exported — only feature.ts and web/index.ts may access it.

export { itemsFeature } from "./feature";
export { itemsClient } from "./web";
