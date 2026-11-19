---
"@cosmicdrift/kumiko-bundled-features": patch
---

New `connectors` feature: a satellite pairs through the OAuth device flow and delivers files.

<!-- kumiko-changes
feature: connectors
type: improvement
title: New connectors feature: devices pair via OAuth device flow and deliver files into an inbound list
detail: A satellite program pairs with `createConnectorsFeature()` through the OAuth device flow (RFC 8628); a TenantAdmin confirms the user code and the device receives a revocable `ksat_` token of which only the SHA-256 is stored. With it the device uploads files (raw bytes, relative path, SHA-256, modification time; the same file again is the same item) and sends heartbeats. Each upload becomes a file reference plus an event-sourced `inbound-item`. Mount the HTTP endpoints with `createConnectorRoutes()` as `extraRoutes`; the protocol is in docs/guides/connectors-satellite.md.
-->
