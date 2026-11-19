---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-dev-server": patch
"@cosmicdrift/kumiko-framework": patch
---

Remove the deprecated securityBaselineFeatures preset; composeSecurityStack replaces it.

<!-- kumiko-changes
feature: dev-server
type: breaking
title: securityBaselineFeatures preset removed
detail: The subpath @cosmicdrift/kumiko-bundled-features/presets is gone with its exports securityBaselineFeatures and SecurityBaselineOptions. composeSecurityStack({ includeSessions }) from @cosmicdrift/kumiko-dev-server/compose-stacks mounts the same features (sessions, crypto-shredding, rate-limiting, audit) in the same order. The production boot warning about a missing security baseline now points to composeSecurityStack.
migration: Replace securityBaselineFeatures({ includeSessions }) with composeSecurityStack({ includeSessions }) from @cosmicdrift/kumiko-dev-server/compose-stacks, or mount createSessionsFeature, createCryptoShreddingFeature, createRateLimitingFeature and createAuditFeature yourself.
affects: securityBaselineFeatures, SecurityBaselineOptions, kumiko-bundled-features/presets
-->
