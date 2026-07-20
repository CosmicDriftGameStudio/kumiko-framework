// Type-only fixture for the KumikoEventTypeMap declaration-merging channel
// (#1394). event-type-map.ts moved the marker interfaces behind a re-export
// chain (kumiko-types -> engine/types/event-type-map.ts shim -> engine
// barrel), while the codegen augmentation channel
// (dev-server/src/codegen/render.ts) still targets
// `declare module "@cosmicdrift/kumiko-framework/engine"`. If a future
// change breaks that re-export chain, augmentation silently stops merging
// and every event payload falls back to `unknown` with no compile error —
// this test only catches it because tsc checks the `declare module` below
// against the SAME specifier the codegen emits.
import { expectTypeOf, test } from "bun:test";
import type { KumikoEventTypeMap } from "@cosmicdrift/kumiko-framework/engine";

declare module "@cosmicdrift/kumiko-framework/engine" {
  interface KumikoEventTypeMap {
    "event-type-map-fixture:probe.created": { readonly probe: true };
  }
}

test("augmenting KumikoEventTypeMap via the engine specifier merges into the relocated interface", () => {
  expectTypeOf<KumikoEventTypeMap["event-type-map-fixture:probe.created"]>().toEqualTypeOf<{
    readonly probe: true;
  }>();
});
