// Public API of the inbound-provider-inmemory bundled-feature.

export {
  contentFetchesOf,
  createInboundProviderInMemoryFeature,
  emitWatchError,
  failNextFetchWith,
  failNextVerifyWith,
  fetchCountOf,
  hangFetchesOf,
  INMEMORY_PROVIDER_KEY,
  isWatching,
  lastFetchSignalOf,
  requireCredentialSecretOnFetch,
  resetInboundInMemory,
  type SentMail,
  seedInboundMessage,
  seedRejectedInboundMessage,
  sentMailsOf,
  setInboundFullContent,
  watchedTrustedAuthservIdOf,
} from "./feature.ts";
