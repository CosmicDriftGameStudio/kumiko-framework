import { describe, expect, test } from "bun:test";
import { classifyField, composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import * as z from "zod";
import { withBootOptionEnvBlocks } from "../option-env-schema.ts";

const appSchema = () => composeEnvSchema({ features: [] });

function kindOf(composed: ReturnType<typeof withBootOptionEnvBlocks>, key: string): string {
  const field = composed.schema.shape[key];
  return field instanceof z.ZodType ? classifyField(field) : "absent";
}

describe("withBootOptionEnvBlocks", () => {
  test("without env-reading options the app schema is returned unchanged", () => {
    const composed = appSchema();
    expect(withBootOptionEnvBlocks(composed, { features: [], demoMode: { readOnly: true } })).toBe(
      composed,
    );
  });

  test('fileStorage "s3-env" requires the four S3 keys, "auto" only lists them', () => {
    const s3 = withBootOptionEnvBlocks(appSchema(), {
      features: [],
      fileStorage: { provider: "s3-env" },
    });
    expect(kindOf(s3, "S3_BUCKET")).toBe("required");
    expect(kindOf(s3, "S3_SECRET_KEY")).toBe("required");
    expect(kindOf(s3, "S3_ENDPOINT")).toBe("optional");
    expect(s3.sources["S3_BUCKET"]).toBe("runProdApp.fileStorage");

    const auto = withBootOptionEnvBlocks(appSchema(), {
      features: [],
      fileStorage: { provider: "auto" },
    });
    expect(kindOf(auto, "S3_BUCKET")).toBe("optional");
  });

  test('an additional "s3-env" provider requires the S3 keys', () => {
    const wired = withBootOptionEnvBlocks(appSchema(), {
      features: [],
      fileStorage: { provider: "inmemory", providers: ["s3-env"] },
    });
    expect(kindOf(wired, "S3_BUCKET")).toBe("required");
  });

  test("a sysadmin tenant without an id requires DEMO_TENANT_ID", () => {
    const wired = withBootOptionEnvBlocks(appSchema(), {
      features: [],
      seeds: { sysadminFromEnv: { tenant: { key: "ops", name: "Ops" } } },
    });
    expect(kindOf(wired, "DEMO_TENANT_ID")).toBe("required");

    const withId = withBootOptionEnvBlocks(appSchema(), {
      features: [],
      seeds: {
        sysadminFromEnv: {
          tenant: { id: "00000000-0000-4000-8000-000000000001", key: "ops", name: "Ops" },
        },
      },
    });
    expect(kindOf(withId, "DEMO_TENANT_ID")).toBe("absent");
  });

  test("kmsMode and billing add their blocks, plaintextReason adds none", () => {
    const wired = withBootOptionEnvBlocks(appSchema(), {
      features: [],
      kmsMode: "required",
      billing: { stripe: { priceToTier: {} }, defaultTier: "free" },
    });
    expect(kindOf(wired, "PLATFORM_KEK")).toBe("optional");
    expect(wired.sources["PLATFORM_KEK"]).toBe("runProdApp.kmsMode");
    expect(wired.sources["STRIPE_API_KEY"]).toBe("runProdApp.billing");

    const plaintext = withBootOptionEnvBlocks(appSchema(), {
      features: [],
      kmsMode: { plaintextReason: "test" },
    });
    expect(kindOf(plaintext, "PLATFORM_KEK")).toBe("absent");
  });

  test("seed shortcuts require only the accounts and tenant id they seed", () => {
    const wired = withBootOptionEnvBlocks(appSchema(), {
      features: [],
      seeds: { demoTenant: { key: "demo", name: "Demo" }, sysadminFromEnv: true },
    });
    expect(kindOf(wired, "DEMO_TENANT_ID")).toBe("required");
    expect(kindOf(wired, "DEMO_SYSADMIN_PASSWORD")).toBe("required");
    expect(kindOf(wired, "DEMO_ADMIN_EMAIL")).toBe("absent");

    const withId = withBootOptionEnvBlocks(appSchema(), {
      features: [],
      seeds: { demoTenant: { id: "00000000-0000-4000-8000-000000000001", key: "d", name: "D" } },
    });
    expect(kindOf(withId, "DEMO_TENANT_ID")).toBe("absent");
  });

  test("an app-declared key keeps its owner but turns required when the option needs it", () => {
    const composed = composeEnvSchema({
      features: [],
      extend: z.object({
        SMTP_HOST: z.string().min(1).optional(),
        SMTP_FROM: z.email().optional(),
      }),
    });
    const wired = withBootOptionEnvBlocks(composed, {
      features: [],
      mail: { transport: "smtp-env" },
    });
    expect(kindOf(wired, "SMTP_HOST")).toBe("required");
    expect(wired.sources["SMTP_HOST"]).toBe("app");
    expect(wired.schema.shape["SMTP_FROM"]).toBe(composed.schema.shape["SMTP_FROM"]);
    expect(wired.sources["SMTP_PORT"]).toBe("runProdApp.mail");
  });
});
