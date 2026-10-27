---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

Inbound mail with configurable roles and private personal mailboxes

`createInboundMailFoundationFeature` and `createInboundProviderImapFeature` take `{ userRoles, adminRoles }` (defaults `User` and `TenantAdmin`/`SystemAdmin`); a boot check rejects deviating options. The mail of a personal mailbox (messages, body, attachments, quarantine) is now readable by its owner only, not by admins; admins still see the account metadata and manage shared mailboxes. The owner reactivates a personal IMAP mailbox in the new "My mailboxes" flow. The content-fetched event is version 3 and carries `accountId` and `ownerUserId` (null for older events). `EntityDefinition.attachedFileAccess: "record-only"` keeps the files privileged roles from reading attached files, and `createDefaultGuard` takes the matching fourth parameter. `SendMailFromAccountContext.dispatch` is query-only. A live list now resyncs on every stream open and an infinity list adopts a refresh that lands during its first load.

<!-- kumiko-changes
feature: inbound-mail-foundation
type: breaking
title: Personal mail is private to its owner, roles are configurable
detail: Admins no longer read messages, bodies, attachments or quarantine of a personal mailbox; list-accounts still shows them the account without counts. The screens and the IMAP handlers are factories (createMailAccountListScreen, createImapConnectScreen and others) taking the resolved roles instead of constants. The content-fetched event is version 3 with accountId and ownerUserId. createDefaultGuard has a fourth parameter recordOnlyEntityTypes.
migration: |
  Apps that import mailAccountListScreen, mailAccountEditScreen, mailAccountSenderCheckScreen, myMailAccountListScreen, mailQuarantineScreen, imapConnectScreen or imapReconnectScreen call the matching create*Screen factory with resolveInboundMailRoles(). Apps with their own roles pass { userRoles, adminRoles } to createInboundMailFoundationFeature and the same options to createInboundProviderImapFeature. Callers of createDefaultGuard pass a Set of record-only entity types as fourth argument. Code that read personal mail as an admin must run as the owner; the nullable accountId and ownerUserId on content-fetched events need no action.
-->
