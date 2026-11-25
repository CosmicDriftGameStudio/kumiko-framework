import type { OptionalPeer } from "../utils/import-optional-peer.ts";

export const MEILISEARCH_PEER: OptionalPeer = {
  name: "meilisearch",
  range: "^0.63.0",
  requiredBy: "@cosmicdrift/kumiko-framework/search/meilisearch",
};
