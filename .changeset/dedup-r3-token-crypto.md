---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Token hashing and HMAC signing share one helper each; stored hashes and token wire formats stay byte-identical.

<!-- kumiko-changes
feature: framework
type: improvement
title: Opaque-token hash and hex helpers exported
detail: @cosmicdrift/kumiko-framework/crypto exports hashOpaqueToken (async, Web Crypto), hashOpaqueTokenSync (node:crypto, for synchronous server paths) and opaqueTokenHashMatches (timing-safe comparison against a stored SHA-256 hex hash). @cosmicdrift/kumiko-framework/utils exports bytesToHex and digestHex(algorithm, text). The framework's own token hashes (personal access tokens, single-use token store, preauth MFA key, export download tokens, termination revocation) use them and produce the same hex as before. Apps that hash share or heartbeat tokens themselves can switch to these helpers without migrating stored hashes.
-->

<!-- kumiko-changes
feature: auth-mfa
type: improvement
title: MFA setup token uses the shared HMAC token codec
detail: signMfaSetupToken and verifyMfaSetupToken run on createHmacTokenCodec with the domain mfa-setup. Tokens issued before the change still verify, and new tokens are byte-identical for the same input. The challenge and preauth-setup tokens share one payload guard, and signed-token and the inbound-mail OAuth state use the same HMAC signature helper.
-->
