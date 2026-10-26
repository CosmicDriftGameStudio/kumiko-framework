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
  type ImapCursor,
  mapImapError,
  parseImapCursor,
} from "./imap-client.ts";
export { buildProviderMessageId, normalizeReferences } from "./parse-message.ts";
