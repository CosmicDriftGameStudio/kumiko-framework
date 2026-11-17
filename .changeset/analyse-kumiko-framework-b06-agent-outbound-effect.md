---
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
---

Write handlers can declare `agent.effect: "outbound"` for writes that leave the system.

<!-- kumiko-changes
feature: framework
type: feature
title: Outbound agent effect
detail: `agent: { effect: "outbound" }` marks a write that sends something out of the system, such as a mail or message. The effect reaches the agent manifest and tool descriptors; the agent then asks for approval on every call and offers no standing approval. Any risk is allowed; `risk: "low"` stays required only for `effect: "proposal"`.
-->
