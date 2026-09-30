// Public API of the inbound-provider-imap bundled-feature.

export {
  type ImapCredentialDocument,
  imapCredentialDocumentSchema,
  type ParseCredentialResult,
  parseImapCredentialDocument,
} from "./credential-document.js";
export { IMAP_PROVIDER_KEY, inboundProviderImapFeature, setImapMailHostLookup } from "./feature.js";
export {
  assertUidValidity,
  buildProviderMessageId,
  type ImapCursor,
  mapImapError,
  normalizeReferences,
  parseImapCursor,
} from "./imap-client.js";
