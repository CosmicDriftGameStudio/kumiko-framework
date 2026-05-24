import { composeEnvSchema, KumikoBootError, parseEnv } from "@cosmicdrift/kumiko-framework/env";
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { type FrameworkCoreEnv, frameworkCoreEnvSchema } from "../env-schema";

describe("frameworkCoreEnvSchema", () => {
  it("accepts a valid minimal env", () => {
    const env = parseEnv(frameworkCoreEnvSchema, {
      DATABASE_URL: "postgres://localhost:5432/db",
      REDIS_URL: "redis://localhost:6379",
    });
    // Defaults populated, optional keys remain undefined.
    expect(env.PORT).toBe("3000");
    expect(env.DATABASE_URL).toBe("postgres://localhost:5432/db");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.KUMIKO_INSTANCE_ID).toBeUndefined();
    expect(env.KUMIKO_SKIP_ES_OPS).toBeUndefined();
  });

  it("aggregates missing required vars (DATABASE_URL + REDIS_URL)", () => {
    try {
      parseEnv(frameworkCoreEnvSchema, {});
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KumikoBootError);
      const boot = err as KumikoBootError;
      const names = boot.errors.map((e) => e.name).sort();
      expect(names).toContain("DATABASE_URL");
      expect(names).toContain("REDIS_URL");
      // PORT has a default → not in the error set
      expect(names).not.toContain("PORT");
    }
  });

  it("rejects an invalid PORT (non-numeric)", () => {
    try {
      parseEnv(frameworkCoreEnvSchema, {
        DATABASE_URL: "postgres://localhost:5432/db",
        REDIS_URL: "redis://localhost:6379",
        PORT: "not-a-port",
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KumikoBootError);
      const port = (err as KumikoBootError).errors.find((e) => e.name === "PORT");
      expect(port?.kind).toBe("invalid");
    }
  });

  it("KUMIKO_SKIP_ES_OPS accepts any string (matches runtime semantics)", () => {
    // Runtime check is `!== "1"` — non-"1" values are silently ignored.
    // The schema mirrors that: validate string-or-unset, not "1"-only.
    const env = parseEnv(frameworkCoreEnvSchema, {
      DATABASE_URL: "postgres://localhost:5432/db",
      REDIS_URL: "redis://localhost:6379",
      KUMIKO_SKIP_ES_OPS: "true",
    });
    expect(env.KUMIKO_SKIP_ES_OPS).toBe("true");
  });

  it("composes into an app-wide schema with source attribution", () => {
    const { schema, sources } = composeEnvSchema({
      core: frameworkCoreEnvSchema,
      features: [],
      extend: z.object({ STUDIO_ADMIN_EMAIL: z.email() }),
    });
    expect(sources["DATABASE_URL"]).toBe("framework-core");
    expect(sources["PORT"]).toBe("framework-core");
    expect(sources["STUDIO_ADMIN_EMAIL"]).toBe("app");

    try {
      parseEnv(schema, {}, { sources });
    } catch (err) {
      const boot = err as KumikoBootError;
      const formatted = boot.format();
      expect(formatted).toContain("✗ DATABASE_URL (framework-core, required, missing)");
      expect(formatted).toContain("✗ REDIS_URL (framework-core, required, missing)");
      expect(formatted).toContain("✗ STUDIO_ADMIN_EMAIL (app, required, missing)");
    }
  });

  it("z.infer<typeof frameworkCoreEnvSchema> typechecks the expected shape", () => {
    // Compile-time test — typecheck must accept this shape exactly.
    const env: FrameworkCoreEnv = {
      PORT: "3000",
      DATABASE_URL: "postgres://localhost/x",
      REDIS_URL: "redis://localhost",
      KUMIKO_INSTANCE_ID: "pod-7",
      KUMIKO_SKIP_ES_OPS: "1",
    };
    expect(env.PORT).toBe("3000");
  });
});
