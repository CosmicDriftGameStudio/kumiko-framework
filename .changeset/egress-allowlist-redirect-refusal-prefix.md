---
"@cosmicdrift/kumiko-http": patch
---

egress(internal) reports allowlist refusals on redirect hops as redirect refusals

<!-- kumiko-changes
feature: http-egress
type: fix
title: A redirect hop outside allowOrigins now fails with the egress(internal): redirect prefix
detail: fetchWithAllowlistedRedirects rethrows an allowlist rejection of a redirect target as "egress(internal): redirect target not in allowlist (<origin> -> <origin>), not followed". Consumers that classify redirect refusals by this prefix, such as the chat webhook sender, now report redirect_blocked instead of network_error for same-host redirects to another port or scheme.
-->
