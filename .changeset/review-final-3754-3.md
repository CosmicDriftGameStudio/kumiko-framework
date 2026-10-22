---
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

`copy-locale` of a template with linked files now reads each source file through the storage provider of the tenant that owns it. Before, it read through the caller's provider, so with one provider per tenant the files of a system template looked missing and the copy silently lost its images and attachments. A file whose row exists but whose bytes cannot be read now fails the copy with `templateResolver.errors.resource.sourceUnreadable` and stores nothing.

<!-- kumiko-changes
feature: template-resolver
type: fix
title: copy-locale reads source files from the owning tenant's storage
detail: The copy of linked files uses readFileRefContent with the provider of the fileRef's tenant. A source file whose fileRef row exists but whose bytes cannot be read fails the copy with template_resource_source_unreadable and releases the files already copied. A deleted fileRef is still left out of the copy.
-->
