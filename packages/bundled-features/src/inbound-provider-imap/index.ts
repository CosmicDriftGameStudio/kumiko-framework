// Public API of the inbound-provider-imap bundled-feature.

export {
  type ImapCredentialDocument,
  imapCredentialDocumentSchema,
  type ParseCredentialResult,
  parseImapCredentialDocument,
} from "./credential-document.ts";
export {
  createInboundProviderImapFeature,
  IMAP_PROVIDER_KEY,
  setImapMailHostLookup,
} from "./feature.ts";
export {
  assertUidValidity,
  buildProviderMessageId,
  type ImapCursor,
  mapImapError,
  normalizeReferences,
  parseImapCursor,
} from "./imap-client.ts";
