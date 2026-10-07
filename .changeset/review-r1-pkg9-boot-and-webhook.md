---
"@cosmicdrift/kumiko-framework": patch
---

Signature extra routes no longer return the verify() error text in the 401 body, drawer prefill and secret field ids fail at boot when they would silently misbehave

A non-`ExtraRouteRejection` throw from a signature route's `verify()` now answers with the generic message "signature verification failed" and logs the detail server-side. Boot now rejects a drawer `params` prefill that targets a sensitive or password field or a field the target layout does not render, a secrets screen whose field ids collide across hyphenated feature names, and a where-rule subquery on a table whose column set cannot be derived.

<!-- kumiko-changes
feature: framework
type: fix
title: Webhook signature 401 hides verify() error details; boot rejects silently dropped drawer prefills, colliding secret field ids and unlintable where-rule tables
-->
