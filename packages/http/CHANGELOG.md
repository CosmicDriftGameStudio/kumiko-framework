# @cosmicdrift/kumiko-http

## 0.286.0

## 0.285.2

## 0.285.1

## 0.285.0

## 0.284.0

### Minor Changes

- 4880f4e: Split egress into a standalone @cosmicdrift/kumiko-http package

  egress() moves from packages/framework/src/http into its own zero-runtime-dependency package, @cosmicdrift/kumiko-http, so the required direct-fetch guard no longer forces slim build tools to pull the framework's 14 runtime dependencies (ioredis, meilisearch, postgres, bullmq, pino, ...). @cosmicdrift/kumiko-framework/http keeps working unchanged via a re-export; the public surface is unaffected.

  <!-- kumiko-changes
  feature: http
  type: improvement
  title: Split egress into a standalone @cosmicdrift/kumiko-http package
  -->
