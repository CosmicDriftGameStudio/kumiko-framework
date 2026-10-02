---
"@cosmicdrift/kumiko-headless": patch
"@cosmicdrift/kumiko-http": patch
"@cosmicdrift/kumiko-framework": patch
---

The `json` format no longer throws on BigInt or circular values and falls back to text. `resolvePublicHost` prefers an IPv4 address on dual-stack hosts. Identity-switch claim comparison no longer treats structurally equal object claims in a different key order as a different identity.

<!-- kumiko-changes
feature: framework
type: fix
title: json format falls back to text, IPv4-first egress pin, structural claim comparison for identity switch
-->
