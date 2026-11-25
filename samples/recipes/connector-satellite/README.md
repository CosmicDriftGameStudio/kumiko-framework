# Recipe: connector-satellite

A program on a customer's own machine (the satellite) delivers files into the app without a
user session. It pairs once through the OAuth device flow and then uses a revocable device
token.

**What the recipe demonstrates:**

- Mount `createConnectorsFeature()` and `createConnectorRoutes()` (as `extraRoutes`)
- Pairing: the satellite asks for a code, a TenantAdmin confirms it through
  `connectors:write:approve-device`, the satellite collects its `ksat_` token once
- Upload: raw bytes plus relative path, SHA-256 and modification time; the same file again
  answers `duplicate: true` instead of creating a second item

The wire protocol for the satellite is in `docs/guides/connectors-satellite.md`.

## Layout

```
samples/recipes/connector-satellite/
├── package.json
├── README.md
└── src/
    ├── feature.ts                              # the feature and its routes
    └── __tests__/satellite.integration.test.ts # pair, confirm, upload twice
```

## Run tests

```bash
bun test --config=bunfig.integration.toml samples/recipes/connector-satellite/src/__tests__/satellite.integration.test.ts
```
