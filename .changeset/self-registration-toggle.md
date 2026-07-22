---
"@cosmicdrift/kumiko-bundled-features": minor
---

auth-email-password: runtime toggle for self-registration. A new handler-less companion feature (`auth-self-registration`, toggleable, default on) lets an operator flip self-signup off at runtime via feature-toggles without redeploying. `signup-request` silently no-ops when off (matching its always-200 anti-enumeration contract), and a new anonymous-readable query (`auth-email-password:query:signup-registration-status`) lets the public signup page hide its own link/form.
