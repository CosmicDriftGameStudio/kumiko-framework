// Integration-style spec for runProdApp's envSchema boot-stage.
// Focus: the env-validation path BEFORE any DB/Redis connection.
// We never reach `requireEnv("DATABASE_URL")` here — invalid env
// throws (via bootErrorReporter override) and KUMIKO_DRY_RUN_ENV
// returns the dry-run handle without booting.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema, KumikoBootError } from "@cosmicdrift/kumiko-framework/env";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runProdApp } from "../run-prod-app";

const secretsFeature = defineFeature("secrets", (r) => {
  r.envSchema(
    z.object({
      KUMIKO_SECRETS_MASTER_KEY_V1: z
        .string()
        .describe("AES-256 KEK")
        .meta({ kumiko: { pulumi: { generator: "openssl rand -base64 32", secret: true } } }),
    }),
  );
});

const authFeature = defineFeature("auth-email-password", (r) => {
  r.envSchema(
    z.object({
      JWT_SECRET: z.string().min(32).describe("JWT signing key"),
    }),
  );
});

const composed = composeEnvSchema({
  features: [secretsFeature, authFeature],
  extend: z.object({
    STUDIO_ADMIN_EMAIL: z.email(),
  }),
});

describe("runProdApp envSchema integration", () => {
  it("aggregates all env-errors at boot, not first-fail", async () => {
    let captured: KumikoBootError | undefined;
    try {
      await runProdApp({
        features: [],
        envSchema: composed,
        pulumiPrefix: "studio",
        envSource: {
          // KUMIKO_SECRETS_MASTER_KEY_V1 missing
          JWT_SECRET: "short", // invalid (min 32)
          STUDIO_ADMIN_EMAIL: "not-an-email", // invalid format
        },
        bootErrorReporter: (err) => {
          captured = err;
          throw err;
        },
      });
    } catch (err) {
      expect(err).toBeInstanceOf(KumikoBootError);
    }
    expect(captured).toBeDefined();
    expect(captured!.errors.length).toBe(3);
    const names = captured!.errors.map((e) => e.name).sort();
    expect(names).toEqual(["JWT_SECRET", "KUMIKO_SECRETS_MASTER_KEY_V1", "STUDIO_ADMIN_EMAIL"]);
    const kek = captured!.errors.find((e) => e.name === "KUMIKO_SECRETS_MASTER_KEY_V1");
    expect(kek?.kind).toBe("missing");
    expect(kek?.suggestion).toBe(
      'Set via: pulumi config set --secret studioKumikoSecretsMasterKeyV1 "$(openssl rand -base64 32)"',
    );
  });

  it("KUMIKO_DRY_RUN_ENV=human prints inventory and returns a dry-run handle", async () => {
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const handle = await runProdApp({
        features: [],
        envSchema: composed,
        envSource: {
          KUMIKO_DRY_RUN_ENV: "human",
        },
      });
      expect(handle).toBeDefined();
      const out = logs.join("\n");
      expect(out).toContain("Required env-vars:");
      expect(out).toContain("KUMIKO_SECRETS_MASTER_KEY_V1");
      expect(out).toContain("(secrets)");
      expect(out).toContain("JWT_SECRET");
      expect(out).toContain("(auth-email-password)");
      expect(out).toContain("STUDIO_ADMIN_EMAIL");
      expect(out).toContain("(app)");
    } finally {
      console.log = realLog;
    }
  });

  it("KUMIKO_DRY_RUN_ENV=pulumi emits `pulumi config set` lines with prefix", async () => {
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await runProdApp({
        features: [],
        envSchema: composed,
        pulumiPrefix: "studio",
        envSource: { KUMIKO_DRY_RUN_ENV: "pulumi" },
      });
      const out = logs.join("\n");
      expect(out).toContain(
        'pulumi config set --secret studioKumikoSecretsMasterKeyV1 "$(openssl rand -base64 32)"',
      );
      expect(out).toContain('pulumi config set studioStudioAdminEmail "<set-me>"');
    } finally {
      console.log = realLog;
    }
  });

  it("KUMIKO_DRY_RUN_ENV=1 aliases to human-mode", async () => {
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await runProdApp({
        features: [],
        envSchema: composed,
        envSource: { KUMIKO_DRY_RUN_ENV: "1" },
      });
      expect(logs.join("\n")).toContain("Required env-vars:");
    } finally {
      console.log = realLog;
    }
  });
});
