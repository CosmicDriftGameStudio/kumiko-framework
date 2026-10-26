// Public API of the inbound-provider-inmemory bundled-feature.

export {
  contentFetchesOf,
  createInboundProviderInMemoryFeature,
  emitWatchError,
  failNextFetchWith,
  failNextVerifyWith,
  hangFetchesOf,
  INMEMORY_PROVIDER_KEY,
  isWatching,
  lastFetchSignalOf,
  requireCredentialSecretOnFetch,
  resetInboundInMemory,
  seedInboundMessage,
  seedRejectedInboundMessage,
  setInboundFullContent,
  watchedTrustedAuthservIdOf,
} from "./feature.ts";
