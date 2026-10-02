import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { SKIP_PII_BACKFILL_ENV, startPiiEventBackfillOnBoot } from "../pii-event-backfill-on-boot";

const piiFeature = defineFeature("backfill-boot-pii", (r) => {
  r.entity(
    "person",
    createEntity({
      table: "read_backfill_boot_persons",
      fields: { email: createTextField({ required: true, personal: "self", find: "exact" }) },
    }),
  );
});
const registry = createRegistry([piiFeature]);

// Any use of the connection rejects, which is how runPiiEventBackfill
// "crashes" once it gets past the KMS/PII skip checks.
const BROKEN_DB = new Proxy(
  {},
  {
    get(): never {
      throw new Error("db unavailable (test)");
    },
  },
) as unknown as DbConnection; // @cast-boundary test double, deliberately throws on any use

type Hook = { readonly name: string; readonly fn: () => Promise<void> };

function recordingLifecycle() {
  const hooks: Hook[] = [];
  return {
    hooks,
    lifecycle: {
      registerShutdownHook(name: string, fn: () => Promise<void>) {
        hooks.push({ name, fn });
      },
    },
  };
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  resetPiiSubjectKmsForTests();
});

describe("startPiiEventBackfillOnBoot", () => {
  test("KUMIKO_SKIP_PII_BACKFILL=1 starts no run and registers no shutdown hook", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { hooks, lifecycle } = recordingLifecycle();

      startPiiEventBackfillOnBoot({
        db: BROKEN_DB,
        registry,
        lifecycle,
        envSource: { [SKIP_PII_BACKFILL_ENV]: "1" },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(hooks).toEqual([]);
      // A started run would have crashed on BROKEN_DB and logged.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("any other opt-out value does not skip", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { hooks, lifecycle } = recordingLifecycle();
      startPiiEventBackfillOnBoot({
        db: BROKEN_DB,
        registry,
        lifecycle,
        envSource: { [SKIP_PII_BACKFILL_ENV]: "0" },
      });
      expect(hooks.map((hook) => hook.name)).toEqual(["piiEventBackfill"]);
      await hooks[0]?.fn();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("a crashing backfill is logged, not thrown: the hook resolves and nothing is unhandled", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { hooks, lifecycle } = recordingLifecycle();

      startPiiEventBackfillOnBoot({ db: BROKEN_DB, registry, lifecycle, envSource: {} });
      expect(hooks.map((hook) => hook.name)).toEqual(["piiEventBackfill"]);

      await hooks[0]?.fn();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, data] = errorSpy.mock.calls[0] ?? [];
      expect(message).toContain("PII event backfill crashed");
      expect(JSON.stringify(data)).toContain("db unavailable (test)");
      expect(unhandled).toEqual([]);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
