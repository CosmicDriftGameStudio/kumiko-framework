#!/usr/bin/env bun
// Schema CLI for the sample: creates the framework infra tables
// (idempotent) and applies kumiko/migrations. Requires DATABASE_URL.
import { runStandaloneSchemaCli } from "@cosmicdrift/kumiko-dev-server/schema-apply";
import { createApiWorkerSplitFeature } from "../src/feature";

await runStandaloneSchemaCli({ features: [createApiWorkerSplitFeature()] });
