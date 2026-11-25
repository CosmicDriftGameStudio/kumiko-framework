---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-dev-server": patch
---

Origin and path trailing-slash trimming, sender address parsing and document text conversion run in linear time; master key versions in error messages sort numerically; the generated deploy/Dockerfile.dockerignore excludes .env* (except .env.example), .pem and .key files.

<!-- kumiko-changes
feature: framework
type: fix
title: Linear-time string trimming and parsing, numeric key versions in errors, .env* excluded from the image build context
detail: Trimming trailing slashes from origins and routed paths, parsing the inbound sender address and converting document HTML to text no longer backtrack on long slash, whitespace or angle-bracket runs. The master key provider lists keyring versions in numeric order in its error messages, so version 10 follows version 2. The managed `deploy/Dockerfile.dockerignore` excludes `**/.env*` (except `.env.example`), `**/*.pem` and `**/*.key` from the build context; `kumiko sync-managed --write` refreshes the file.
-->
