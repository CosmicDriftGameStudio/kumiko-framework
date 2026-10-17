---
"@cosmicdrift/kumiko-bundled-features": minor
---

Email channel can send through the tenant's own mail provider

<!-- kumiko-changes
feature: channel-email
type: improvement
title: Email channel can send through the tenant's own mail provider
detail: EmailChannelOptions gets tenantTransport, a resolver called per send with the delivery channel context. mail-foundation exports tenantMailTransport for it: a tenant with a provider configured sends through its own transport, a broken provider fails the send, a tenant without a provider uses the app transport. The transport is built per send and never cached, and the tenant comes from the server-side delivery context only. ChannelContext now carries the tenant's config accessor as config. Without tenantTransport nothing changes.
-->
