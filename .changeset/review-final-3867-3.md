---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Removes the unused `ProviderPluginContext` type and its `providerPluginContextFromHandler` / `providerPluginContextFromJob` helpers.

<!-- kumiko-changes
feature: framework
type: breaking
title: Unused ProviderPluginContext helpers removed
detail: ProviderPluginContext, providerPluginContextFromHandler and providerPluginContextFromJob are gone. No plugin type or resolver used them, and the type exposed db handles without an audit user. Provider contexts stay the narrow FileProviderContext, MailTransportContext and InboundMailContext.
migration: no known callers; use FileProviderContext, MailTransportContext or InboundMailContext
-->
