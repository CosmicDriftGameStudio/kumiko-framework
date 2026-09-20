import { ensureTemporalPolyfill } from "@cosmicdrift/kumiko-framework/time";

await ensureTemporalPolyfill();

process.env["KUMIKO_INSTANCE_ID"] ??= "test-instance";
process.env.NODE_ENV ??= "test";
