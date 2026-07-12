// Public API of the inbound-provider-imap bundled-feature.

export {
  type ImapCredentialDocument,
  imapCredentialDocumentSchema,
  type ParseCredentialResult,
  parseImapCredentialDocument,
} from "./credential-document";
export { IMAP_PROVIDER_KEY, inboundProviderImapFeature } from "./feature";
export {
  assertUidValidity,
  buildProviderMessageId,
  type ImapCursor,
  mapImapError,
  normalizeReferences,
  parseImapCursor,
} from "./imap-client";
